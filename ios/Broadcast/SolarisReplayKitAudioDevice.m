#import "SolarisReplayKitAudioDevice.h"
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <math.h>

// WebRTC's ObjC audio device module owns FineAudioBuffer, whose job is to turn
// variable-size device callbacks into WebRTC's internal 10 ms blocks. ReplayKit
// already supplies clocked app-audio callbacks, so deliver each converted
// callback exactly once. A second dispatch timer fights that clock and can
// create audible stalls even when its separate PCM queue never underflows.
static const NSUInteger SolarisAudioBytesPerFrame = 2 * sizeof(int16_t);

typedef struct {
  AudioBufferList *bufferList;
  UInt32 frames;
  UInt32 frameOffset;
  UInt32 bytesPerFrame;
} SolarisAudioConverterInput;

static OSStatus SolarisAudioConverterInputCallback(AudioConverterRef converter,
                                                    UInt32 *packets,
                                                    AudioBufferList *bufferList,
                                                    AudioStreamPacketDescription **packetDescription,
                                                    void *context) {
  SolarisAudioConverterInput *input = context;
  if (input->frameOffset >= input->frames || input->bytesPerFrame == 0) {
    *packets = 0;
    return noErr;
  }
  UInt32 requestedFrames = *packets;
  UInt32 remainingFrames = input->frames - input->frameOffset;
  UInt32 providedFrames = MIN(requestedFrames, remainingFrames);
  *packets = providedFrames;
  bufferList->mNumberBuffers = input->bufferList->mNumberBuffers;
  for (UInt32 index = 0; index < input->bufferList->mNumberBuffers; index++) {
    AudioBuffer source = input->bufferList->mBuffers[index];
    bufferList->mBuffers[index] = source;
    NSUInteger byteOffset = (NSUInteger)input->frameOffset * input->bytesPerFrame;
    NSUInteger requestedBytes = (NSUInteger)providedFrames * input->bytesPerFrame;
    if (source.mData && byteOffset <= source.mDataByteSize) {
      bufferList->mBuffers[index].mData = (uint8_t *)source.mData + byteOffset;
      bufferList->mBuffers[index].mDataByteSize =
          (UInt32)MIN(requestedBytes, source.mDataByteSize - byteOffset);
    } else {
      bufferList->mBuffers[index].mData = NULL;
      bufferList->mBuffers[index].mDataByteSize = 0;
    }
  }
  input->frameOffset += providedFrames;
  return noErr;
}

@interface SolarisReplayKitAudioDevice () {
  id<RTCAudioDeviceDelegate> _delegate;
  dispatch_queue_t _queue;
  AudioConverterRef _converter;
  AudioStreamBasicDescription _converterInput;
  BOOL _hasConverterInput;
  BOOL _initialized;
  BOOL _recordingInitialized;
  BOOL _recording;
  BOOL _playing;
  BOOL _reportedInputDuration;
  NSInteger _appSampleBuffers;
  int64_t _submittedFrames;
  int64_t _droppedFrames;
  int64_t _deliveryCallbacks;
  int64_t _converterResetCount;
  double _maxDeliveryGapMilliseconds;
  double _lastDeliveryUptime;
  NSTimeInterval _inputBufferDuration;
  NSString *_inputDescription;
}
@end

@implementation SolarisReplayKitAudioDevice

- (instancetype)init {
  self = [super init];
  if (self) {
    dispatch_queue_attr_t attributes = dispatch_queue_attr_make_with_qos_class(
        DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0);
    _queue = dispatch_queue_create("org.solaris.probe.replaykit-app-audio", attributes);
    _inputBufferDuration = 0.020;
    _inputDescription = @"대기";
  }
  return self;
}

- (void)dealloc {
  if (_converter) AudioConverterDispose(_converter);
}

- (NSInteger)appSampleBuffers { @synchronized (self) { return _appSampleBuffers; } }
- (int64_t)submittedFrames { @synchronized (self) { return _submittedFrames; } }
- (int64_t)droppedFrames { @synchronized (self) { return _droppedFrames; } }
// Kept in the diagnostics schema so build28 reports remain comparable. The
// build29 path has no external ring buffer, so these remain zero by design.
- (int64_t)underrunCount { return 0; }
- (int64_t)overrunCount { return 0; }
- (double)bufferedMilliseconds { return 0.0; }
- (int64_t)deliveryCallbacks { @synchronized (self) { return _deliveryCallbacks; } }
- (int64_t)converterResetCount { @synchronized (self) { return _converterResetCount; } }
- (double)maxDeliveryGapMilliseconds { @synchronized (self) { return _maxDeliveryGapMilliseconds; } }
- (NSString *)inputDescription { @synchronized (self) { return _inputDescription; } }

- (double)deviceInputSampleRate { return 48000.0; }
- (NSTimeInterval)inputIOBufferDuration { @synchronized (self) { return _inputBufferDuration; } }
- (NSInteger)inputNumberOfChannels { return 2; }
- (NSTimeInterval)inputLatency { return 0.0; }
- (double)deviceOutputSampleRate { return 48000.0; }
- (NSTimeInterval)outputIOBufferDuration { return 0.010; }
- (NSInteger)outputNumberOfChannels { return 2; }
- (NSTimeInterval)outputLatency { return 0.0; }
- (BOOL)isInitialized { return _initialized; }
- (BOOL)isPlayoutInitialized { return _initialized; }
- (BOOL)isPlaying { return _playing; }
- (BOOL)isRecordingInitialized { return _recordingInitialized; }
- (BOOL)isRecording { return _recording; }

- (BOOL)initializeWithDelegate:(id<RTCAudioDeviceDelegate>)delegate {
  _delegate = delegate;
  _initialized = YES;
  return YES;
}

- (BOOL)terminateDevice {
  _initialized = NO;
  _recordingInitialized = NO;
  _recording = NO;
  _playing = NO;
  [self stop];
  _delegate = nil;
  return YES;
}

// The extension only sends. Successful no-op playout methods keep native ADM
// initialization symmetric without opening a speaker or microphone device.
- (BOOL)initializePlayout { return _initialized; }
- (BOOL)startPlayout { _playing = YES; return YES; }
- (BOOL)stopPlayout { _playing = NO; return YES; }
- (BOOL)initializeRecording { _recordingInitialized = _initialized; return _recordingInitialized; }
- (BOOL)startRecording { _recording = _recordingInitialized; return _recording; }
- (BOOL)stopRecording { _recording = NO; return YES; }

- (void)appendApplicationAudioSampleBuffer:(CMSampleBufferRef)sampleBuffer {
  if (!sampleBuffer || !CMSampleBufferDataIsReady(sampleBuffer)) return;
  CFRetain(sampleBuffer);
  dispatch_async(_queue, ^{
    [self consumeApplicationAudioSampleBuffer:sampleBuffer];
    CFRelease(sampleBuffer);
  });
}

- (void)consumeApplicationAudioSampleBuffer:(CMSampleBufferRef)sampleBuffer {
  @synchronized (self) { _appSampleBuffers += 1; }
  if (!_recording || !_delegate) return;

  CMAudioFormatDescriptionRef description = CMSampleBufferGetFormatDescription(sampleBuffer);
  const AudioStreamBasicDescription *input =
      description ? CMAudioFormatDescriptionGetStreamBasicDescription(description) : NULL;
  UInt32 inputFrames = (UInt32)MAX(0, CMSampleBufferGetNumSamples(sampleBuffer));
  if (!input || inputFrames == 0 || input->mSampleRate <= 0) {
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }
  if (![self configureConverterForInput:*input]) {
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }

  // Keep ADM's declared device callback duration in sync with the real
  // ReplayKit callback. WebRTC warns that mismatched device parameters can
  // cause partial transmission and audible artifacts.
  NSTimeInterval callbackDuration = (NSTimeInterval)inputFrames / input->mSampleRate;
  BOOL shouldNotifyDuration = NO;
  @synchronized (self) {
    if (!_reportedInputDuration) {
      _inputBufferDuration = callbackDuration;
      _reportedInputDuration = YES;
      shouldNotifyDuration = YES;
    }
  }
  if (shouldNotifyDuration) {
    id<RTCAudioDeviceDelegate> delegate = _delegate;
    [delegate dispatchAsync:^{ [delegate notifyAudioInputParametersChange]; }];
  }

  size_t listSize = 0;
  OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer, &listSize, NULL, 0, kCFAllocatorDefault, kCFAllocatorDefault,
      kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, NULL);
  if (status != noErr || listSize == 0) {
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }
  AudioBufferList *inputList = malloc(listSize);
  CMBlockBufferRef retainedBlock = NULL;
  status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer, &listSize, inputList, listSize, kCFAllocatorDefault,
      kCFAllocatorDefault, kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
      &retainedBlock);
  if (status != noErr) {
    free(inputList);
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }

  const UInt32 outputCapacity =
      (UInt32)ceil((double)inputFrames * 48000.0 / input->mSampleRate) + 16;
  NSMutableData *converted =
      [NSMutableData dataWithLength:(NSUInteger)outputCapacity * SolarisAudioBytesPerFrame];
  AudioBufferList outputList;
  outputList.mNumberBuffers = 1;
  outputList.mBuffers[0].mNumberChannels = 2;
  outputList.mBuffers[0].mDataByteSize = (UInt32)converted.length;
  outputList.mBuffers[0].mData = converted.mutableBytes;
  SolarisAudioConverterInput converterInput = {
      inputList, inputFrames, 0, input->mBytesPerFrame};
  UInt32 outputFrames = outputCapacity;
  status = AudioConverterFillComplexBuffer(_converter, SolarisAudioConverterInputCallback,
      &converterInput, &outputFrames, &outputList, NULL);
  if (retainedBlock) CFRelease(retainedBlock);
  free(inputList);
  if (status != noErr || outputFrames == 0) {
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }

  [converted setLength:(NSUInteger)outputFrames * SolarisAudioBytesPerFrame];
  [self deliverConvertedPCM:converted frames:outputFrames sampleBuffer:sampleBuffer];
}

- (BOOL)configureConverterForInput:(AudioStreamBasicDescription)input {
  BOOL sameFormat = _hasConverterInput && _converter &&
      _converterInput.mSampleRate == input.mSampleRate &&
      _converterInput.mFormatID == input.mFormatID &&
      _converterInput.mFormatFlags == input.mFormatFlags &&
      _converterInput.mBytesPerPacket == input.mBytesPerPacket &&
      _converterInput.mFramesPerPacket == input.mFramesPerPacket &&
      _converterInput.mBytesPerFrame == input.mBytesPerFrame &&
      _converterInput.mChannelsPerFrame == input.mChannelsPerFrame &&
      _converterInput.mBitsPerChannel == input.mBitsPerChannel;
  if (sameFormat) return YES;
  if (_converter) { AudioConverterDispose(_converter); _converter = NULL; }

  AudioStreamBasicDescription output = {0};
  output.mSampleRate = 48000.0;
  output.mFormatID = kAudioFormatLinearPCM;
  output.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  output.mBytesPerPacket = SolarisAudioBytesPerFrame;
  output.mFramesPerPacket = 1;
  output.mBytesPerFrame = SolarisAudioBytesPerFrame;
  output.mChannelsPerFrame = 2;
  output.mBitsPerChannel = 16;
  OSStatus status = AudioConverterNew(&input, &output, &_converter);
  _hasConverterInput = (status == noErr && _converter != NULL);
  _converterInput = input;
  @synchronized (self) {
    _converterResetCount += 1;
    _inputDescription = [NSString stringWithFormat:
        @"%.0fHz · %u채널 · flags 0x%X · %u-bit → 48kHz S16 스테레오",
        input.mSampleRate, (unsigned)input.mChannelsPerFrame,
        (unsigned)input.mFormatFlags, (unsigned)input.mBitsPerChannel];
  }
  return _hasConverterInput;
}

- (void)deliverConvertedPCM:(NSMutableData *)pcm
                      frames:(UInt32)frames
                sampleBuffer:(CMSampleBufferRef)sampleBuffer {
  if (!_recording || !_delegate || frames == 0) return;
  AudioBufferList list;
  list.mNumberBuffers = 1;
  list.mBuffers[0].mNumberChannels = 2;
  list.mBuffers[0].mDataByteSize = (UInt32)pcm.length;
  list.mBuffers[0].mData = pcm.mutableBytes;
  AudioUnitRenderActionFlags flags = 0;
  AudioTimeStamp timestamp = {0};
  CMTime presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
  Float64 seconds = CMTimeGetSeconds(presentationTime);
  if (CMTIME_IS_VALID(presentationTime) && isfinite(seconds)) {
    timestamp.mSampleTime = seconds * 48000.0;
    timestamp.mFlags = kAudioTimeStampSampleTimeValid;
  }

  double now = NSProcessInfo.processInfo.systemUptime;
  double gapMilliseconds =
      _lastDeliveryUptime > 0 ? (now - _lastDeliveryUptime) * 1000.0 : 0;
  _lastDeliveryUptime = now;
  OSStatus status = _delegate.deliverRecordedData(
      &flags, &timestamp, 1, frames, &list, NULL, nil);
  if (status == noErr) {
    @synchronized (self) {
      _submittedFrames += frames;
      _deliveryCallbacks += 1;
      _maxDeliveryGapMilliseconds = MAX(_maxDeliveryGapMilliseconds, gapMilliseconds);
    }
  } else {
    @synchronized (self) { _droppedFrames += frames; }
  }
}

- (void)stop {
  dispatch_sync(_queue, ^{
    if (_converter) { AudioConverterDispose(_converter); _converter = NULL; }
    _hasConverterInput = NO;
    _lastDeliveryUptime = 0;
  });
}

@end
