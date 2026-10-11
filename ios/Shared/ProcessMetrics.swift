import Foundation
import Darwin

enum SolarisProcessMetrics {
    static func snapshot() -> [String: Any] {
        var result: [String: Any] = ["uptimeSeconds": ProcessInfo.processInfo.systemUptime]
        var usage = rusage()
        if getrusage(RUSAGE_SELF, &usage) == 0 {
            result["cpuSeconds"] = Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1_000_000
        }
        var memory = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let status = withUnsafeMutablePointer(to: &memory) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        if status == KERN_SUCCESS { result["memoryBytes"] = memory.resident_size }
        return result
    }
}
