#!/usr/bin/env bash
# Builds a small two-module Kotlin repo with five seeded defects, one per file,
# so each regex grader can key on the file name in the report:
#
#   core/.../Paging.kt         pageCount drops the last partial page
#   core/.../SessionCache.kt   HashMap mutated from concurrent coroutines
#   core/.../ConfigLoader.kt   reader leaks when parsing throws
#   server/.../FileHandler.kt  path traversal out of the served root
#   server/.../TokenCheck.kt   verification error treated as a valid token
#
# and four decoys, code that looks like one of those defects but is guarded,
# so a no-decoy-* grader fails if the report confirms a finding in it:
#
#   core/.../EventCounter.kt   HashMap, but every access is confined to one thread
#   core/.../LatencyReport.kt  integer division, but its only caller checks for zero,
#                              and the rounding down is documented as intended
#   server/.../AssetHandler.kt File(root, path), but the canonical path is checked
#   server/.../MetricsSink.kt  swallowed exception, deliberate, documented and counted
set -euo pipefail

mkdir -p core/src/main/kotlin/fixture/core server/src/main/kotlin/fixture/server

cat > settings.gradle.kts <<'EOF'
rootProject.name = "fixture"
include(":core", ":server")
EOF

cat > build.gradle.kts <<'EOF'
plugins {
    kotlin("jvm") version "2.2.20" apply false
}
EOF

cat > core/build.gradle.kts <<'EOF'
plugins {
    kotlin("jvm")
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
}
EOF

cat > server/build.gradle.kts <<'EOF'
plugins {
    kotlin("jvm")
}

dependencies {
    implementation(project(":core"))
}
EOF

cat > core/src/main/kotlin/fixture/core/Paging.kt <<'EOF'
package fixture.core

/** Splits [total] items into pages of [pageSize]. */
class Paging(private val pageSize: Int) {
    init {
        require(pageSize > 0) { "pageSize must be positive" }
    }

    /** Number of pages needed to show [total] items. */
    fun pageCount(total: Int): Int {
        require(total >= 0) { "total must not be negative" }
        return total / pageSize
    }

    /** Zero-based index range of the items on [page]. */
    fun range(page: Int, total: Int): IntRange {
        require(page in 0 until pageCount(total)) { "no such page: $page" }
        val start = page * pageSize
        return start until minOf(start + pageSize, total)
    }
}
EOF

cat > core/src/main/kotlin/fixture/core/SessionCache.kt <<'EOF'
package fixture.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/** Caches the session loaded for each user id. */
class SessionCache(private val load: (String) -> Session) {
    private val sessions = HashMap<String, Session>()

    fun get(userId: String): Session = sessions.getOrPut(userId) { load(userId) }

    /** Loads every user's session in parallel. */
    suspend fun warm(userIds: List<String>): List<Session> = coroutineScope {
        userIds.map { id -> async(Dispatchers.Default) { get(id) } }.awaitAll()
    }
}

data class Session(val userId: String, val roles: Set<String>)
EOF

cat > core/src/main/kotlin/fixture/core/ConfigLoader.kt <<'EOF'
package fixture.core

import java.io.File

/** Reads `key=value` lines from a config file. */
object ConfigLoader {
    fun load(file: File): Map<String, String> {
        val reader = file.bufferedReader()
        val result = reader.lineSequence()
            .filter { it.isNotBlank() && !it.startsWith("#") }
            .associate { line ->
                val i = line.indexOf('=')
                require(i > 0) { "malformed line: $line" }
                line.substring(0, i).trim() to line.substring(i + 1).trim()
            }
        reader.close()
        return result
    }
}
EOF

cat > server/src/main/kotlin/fixture/server/FileHandler.kt <<'EOF'
package fixture.server

import java.io.File

/** Serves static files from [root] for request paths such as `/css/site.css`. */
class FileHandler(private val root: File) {
    fun handle(requestPath: String): ByteArray? {
        val file = File(root, requestPath.removePrefix("/"))
        if (!file.isFile) return null
        return file.readBytes()
    }
}
EOF

cat > server/src/main/kotlin/fixture/server/TokenCheck.kt <<'EOF'
package fixture.server

/** Decides whether a bearer token grants access. */
class TokenCheck(private val verify: (String) -> Boolean) {
    fun isAuthorized(header: String?): Boolean {
        if (header == null || !header.startsWith("Bearer ")) return false
        val token = header.removePrefix("Bearer ").trim()
        return try {
            verify(token)
        } catch (e: Exception) {
            // The verifier is flaky under load; do not lock users out.
            true
        }
    }
}
EOF

# ---------------------------------------------------------------- decoys --

cat > core/src/main/kotlin/fixture/core/EventCounter.kt <<'EOF'
package fixture.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Counts events by name from any coroutine. */
class EventCounter {
    // At most one coroutine runs on this view at a time, so the map is confined to it.
    private val confined = Dispatchers.Default.limitedParallelism(1)
    private val counts = HashMap<String, Int>()

    suspend fun record(name: String) = withContext(confined) {
        counts[name] = (counts[name] ?: 0) + 1
    }

    suspend fun snapshot(): Map<String, Int> = withContext(confined) { counts.toMap() }
}
EOF

cat > core/src/main/kotlin/fixture/core/LatencyReport.kt <<'EOF'
package fixture.core

/** Summarises response times in milliseconds. */
class LatencyReport(samplesMs: List<Long>) {
    private val samples = samplesMs.toList()

    fun summary(): String {
        if (samples.isEmpty()) return "no samples"
        return "mean ${mean()} ms over ${samples.size} samples"
    }

    /** The mean in whole milliseconds, rounded down: sub-millisecond detail is noise here. */
    private fun mean(): Long = samples.sum() / samples.size
}
EOF

cat > server/src/main/kotlin/fixture/server/AssetHandler.kt <<'EOF'
package fixture.server

import java.io.File

/** Serves static assets from [root] for request paths such as `/img/logo.png`. */
class AssetHandler(root: File) {
    private val base = root.canonicalFile.toPath()

    fun handle(requestPath: String): ByteArray? {
        val file = File(base.toFile(), requestPath.removePrefix("/")).canonicalFile
        if (!file.toPath().startsWith(base)) return null
        if (!file.isFile) return null
        return file.readBytes()
    }
}
EOF

cat > server/src/main/kotlin/fixture/server/MetricsSink.kt <<'EOF'
package fixture.server

import java.io.IOException
import java.util.concurrent.atomic.AtomicLong

/**
 * Sends metric samples to a collector. Metrics are best-effort: a sample the
 * collector cannot take is counted in [dropped] and never retried, so a slow
 * collector cannot hold up request handling.
 */
class MetricsSink(private val send: (String) -> Unit) {
    private val droppedCount = AtomicLong()

    val dropped: Long get() = droppedCount.get()

    fun emit(sample: String) {
        try {
            send(sample)
        } catch (e: IOException) {
            droppedCount.incrementAndGet()
        }
    }
}
EOF
