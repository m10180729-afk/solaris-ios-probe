#import <CoreMedia/CoreMedia.h>
#import <WebRTC/WebRTC.h>

// ReplayKit delivers application sound as CMSampleBuffer values.  The stock
// WebRTC iOS audio device only captures the microphone, so this small custom
// ADM is the explicit bridge for .audioApp.  It never opens or reads mic input.
@interface SolarisReplayKitAudioDevice : NSObject <RTCAudioDevice>

@property(nonatomic, readonly) NSInteger appSampleBuffers;
@property(nonatomic, readonly) int64_t submittedFrames;
@property(nonatomic, readonly) int64_t droppedFrames;
@property(nonatomic, readonly) int64_t underrunCount;
@property(nonatomic, readonly) int64_t overrunCount;
@property(nonatomic, readonly) double bufferedMilliseconds;
@property(nonatomic, readonly) NSString *inputDescription;

- (void)appendApplicationAudioSampleBuffer:(CMSampleBufferRef)sampleBuffer;
- (void)stop;

@end
