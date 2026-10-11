import Foundation
@main struct ProcessMetricsTests {
    static func main() {
        let metrics = SolarisProcessMetrics.snapshot()
        guard let memory = metrics["memoryBytes"] as? NSNumber, memory.uint64Value > 0,
              let cpu = metrics["cpuSeconds"] as? Double, cpu >= 0,
              let uptime = metrics["uptimeSeconds"] as? Double, uptime > 0 else { fatalError("Process metrics unavailable") }
        print("PASS: Darwin process memory and CPU metrics; device capture not tested")
    }
}
