namespace SolarisNativeHost;

internal static class FramePostPolicy
{
    internal const int MaxPendingFrames = 2;
    internal const long MaxUiAgeUs = 250_000;

    internal static bool DropBeforeQueue(bool awaitingKeyFrame, bool keyFrame, int pendingFrames) =>
        (awaitingKeyFrame && !keyFrame) || pendingFrames > MaxPendingFrames;

    internal static bool DropAtUi(bool sameCaptureRequest, long ageUs, bool awaitingKeyFrame, bool keyFrame) =>
        !sameCaptureRequest || ageUs > MaxUiAgeUs || (awaitingKeyFrame && !keyFrame);
}
