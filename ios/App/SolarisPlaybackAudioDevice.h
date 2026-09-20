#import <WebRTC/WebRTC.h>
NS_ASSUME_NONNULL_BEGIN
// Output-only RemoteIO: no input bus, microphone, or VoiceProcessingIO.
@interface SolarisPlaybackAudioDevice : NSObject <RTCAudioDevice>
@property(nonatomic, readonly) NSString *lastError;
@end

NS_ASSUME_NONNULL_END
