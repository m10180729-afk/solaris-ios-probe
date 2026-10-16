using System.Text.Json;

namespace SolarisNativeHost;

// Keep the original build54 engine separate from the lifecycle/signaling wrapper.
internal sealed class OriginalRtpEngine(Action<object> emit) : IBuild54RtpEngine
{
    private readonly NativeRtpBroadcast original = new(emit);
    public Task Command(JsonElement message) => original.Command(message);
    public void Dispose() => original.Dispose();
}
