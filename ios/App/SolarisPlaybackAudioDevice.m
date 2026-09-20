#import "SolarisPlaybackAudioDevice.h"
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <string.h>

@interface SolarisPlaybackAudioDevice () {
  id<RTCAudioDeviceDelegate> _delegate;
  RTCAudioDeviceGetPlayoutDataBlock _pull;
  AudioUnit _unit;
  BOOL _initialized, _playing, _wanted;
  id _interruptionObserver;
}
@property(nonatomic, readwrite) NSString *lastError;
- (OSStatus)render:(AudioUnitRenderActionFlags *)flags timestamp:(const AudioTimeStamp *)time
           frames:(UInt32)frames buffers:(AudioBufferList *)buffers;
@end
static OSStatus Render(void *context, AudioUnitRenderActionFlags *flags,
                       const AudioTimeStamp *time, UInt32 bus, UInt32 frames, AudioBufferList *buffers) {
  return [(__bridge SolarisPlaybackAudioDevice *)context render:flags timestamp:time frames:frames buffers:buffers];
}
@implementation SolarisPlaybackAudioDevice
- (instancetype)init { if ((self = [super init])) _lastError = @""; return self; }
- (double)deviceInputSampleRate { return 48000; }
- (double)deviceOutputSampleRate { return 48000; }
- (NSTimeInterval)inputIOBufferDuration { return .01; }
- (NSTimeInterval)outputIOBufferDuration { return AVAudioSession.sharedInstance.IOBufferDuration; }
- (NSInteger)inputNumberOfChannels { return 2; }
- (NSInteger)outputNumberOfChannels { return 2; }
- (NSTimeInterval)inputLatency { return 0; }
- (NSTimeInterval)outputLatency { return AVAudioSession.sharedInstance.outputLatency; }
- (BOOL)isInitialized { return _initialized; }
- (BOOL)isPlayoutInitialized { return _unit != NULL; }
- (BOOL)isPlaying { return _playing; }
- (BOOL)isRecordingInitialized { return NO; }
- (BOOL)isRecording { return NO; }
- (BOOL)initializeRecording { return NO; }
- (BOOL)startRecording { return NO; }
- (BOOL)stopRecording { return YES; }
- (BOOL)initializeWithDelegate:(id<RTCAudioDeviceDelegate>)delegate {
  _delegate = delegate; _pull = [delegate.getPlayoutData copy]; _initialized = YES;
  __weak typeof(self) weakSelf = self;
  _interruptionObserver = [NSNotificationCenter.defaultCenter
    addObserverForName:AVAudioSessionInterruptionNotification object:nil queue:nil
    usingBlock:^(NSNotification *note) {
      typeof(self) self = weakSelf;
      if (!self) return;
      id<RTCAudioDeviceDelegate> owner = self->_delegate;
      if (!owner) return;
      [owner dispatchAsync:^{
        if (!self->_initialized) return;
        if ([note.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue] == AVAudioSessionInterruptionTypeBegan) {
          if (self->_unit) AudioOutputUnitStop(self->_unit);
          self->_playing = NO;
          [owner notifyAudioOutputInterrupted];
        } else if (self->_wanted) {
          [self startPlayout];
        }
      }];
    }];
  return YES;
}
- (BOOL)check:(OSStatus)status operation:(NSString *)operation {
  if (status == noErr) return YES;
  self.lastError = [NSString stringWithFormat:@"%@: OSStatus %d", operation, (int)status];
  return NO;
}
- (BOOL)initializePlayout {
  if (_unit) return YES;
  NSError *error = nil;
  AVAudioSession *session = AVAudioSession.sharedInstance;
  if (![session setCategory:AVAudioSessionCategoryPlayback mode:AVAudioSessionModeMoviePlayback options:0 error:&error] ||
      ![session setActive:YES error:&error]) {
    self.lastError = error.localizedDescription; return NO;
  }
  [session setPreferredSampleRate:48000 error:nil];
  [session setPreferredIOBufferDuration:.01 error:nil];
  AudioComponentDescription description = {kAudioUnitType_Output, kAudioUnitSubType_RemoteIO,
    kAudioUnitManufacturer_Apple, 0, 0};
  AudioComponent component = AudioComponentFindNext(NULL, &description);
  if (!component) { self.lastError = @"RemoteIO unavailable"; return NO; }
  if (![self check:AudioComponentInstanceNew(component, &_unit) operation:@"Create output"]) return NO;
  UInt32 disabled = 0;
  AudioStreamBasicDescription format = {0};
  format.mSampleRate = 48000;
  format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  format.mBytesPerPacket = 4; format.mFramesPerPacket = 1;
  format.mBytesPerFrame = 4; format.mChannelsPerFrame = 2; format.mBitsPerChannel = 16;
  AURenderCallbackStruct callback = {Render, (__bridge void *)self};
  if (![self check:AudioUnitSetProperty(_unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, 1, &disabled, sizeof(disabled)) operation:@"Disable input"] ||
      ![self check:AudioUnitSetProperty(_unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0, &format, sizeof(format)) operation:@"Stereo PCM format"] ||
      ![self check:AudioUnitSetProperty(_unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, 0, &callback, sizeof(callback)) operation:@"Output callback"] ||
      ![self check:AudioUnitInitialize(_unit) operation:@"Initialize output"]) {
    AudioComponentInstanceDispose(_unit); _unit = NULL; return NO;
  }
  [_delegate notifyAudioOutputParametersChange];
  return YES;
}
- (BOOL)startPlayout {
  _wanted = YES;
  if (_playing) return YES;
  NSError *error = nil;
  if (![AVAudioSession.sharedInstance setActive:YES error:&error]) {
    self.lastError = error.localizedDescription; return NO;
  }
  if (![self initializePlayout]) return NO;
  _playing = [self check:AudioOutputUnitStart(_unit) operation:@"Start output"];
  return _playing;
}
- (BOOL)stopPlayout {
  _wanted = NO;
  if (_unit) AudioOutputUnitStop(_unit);
  _playing = NO;
  return YES;
}
- (BOOL)terminateDevice {
  [self stopPlayout];
  if (_interruptionObserver) [NSNotificationCenter.defaultCenter removeObserver:_interruptionObserver];
  _interruptionObserver = nil;
  if (_unit) { AudioUnitUninitialize(_unit); AudioComponentInstanceDispose(_unit); _unit = NULL; }
  _pull = nil; _delegate = nil; _initialized = NO; return YES;
}
- (OSStatus)render:(AudioUnitRenderActionFlags *)flags timestamp:(const AudioTimeStamp *)time
           frames:(UInt32)frames buffers:(AudioBufferList *)buffers {
  OSStatus status = _pull ? _pull(flags, time, 0, frames, buffers) : -1;
  if (status != noErr) {
    for (UInt32 i = 0; i < buffers->mNumberBuffers; i++)
      if (buffers->mBuffers[i].mData) memset(buffers->mBuffers[i].mData, 0, buffers->mBuffers[i].mDataByteSize);
    *flags |= kAudioUnitRenderAction_OutputIsSilence;
  }
  return noErr;
}
@end
