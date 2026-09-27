#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Hardware-backed H.264 display surface used by Solaris' integrated
/// Windows sender. Frames arrive through an unreliable WebRTC data channel
/// as Annex-B access units and are decoded by VideoToolbox/AVFoundation.
@interface SolarisH264DisplayView : UIView

@property(nonatomic, readonly) NSInteger enqueuedFrames;
@property(nonatomic, readonly) NSInteger droppedFrames;
@property(nonatomic, copy, readonly) NSString *lastError;

- (void)enqueueAnnexBFrame:(NSData *)data
       presentationTimeUs:(int64_t)presentationTimeUs
                  keyFrame:(BOOL)keyFrame;
- (void)resetDecoder;

@end

NS_ASSUME_NONNULL_END
