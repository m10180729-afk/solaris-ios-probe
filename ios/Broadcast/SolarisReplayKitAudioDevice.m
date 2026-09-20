#import "SolarisReplayKitAudioDevice.h"
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <math.h>

typedef struct {
  AudioBufferList *bufferList;
  UInt32 frames;
  BOOL consumed;
} SolarisAudioConverterInput;

static OSStatus SolarisAudioConverterInputCallback(AudioConverterRef converter,
                                                    UInt32 *packets,
                                                    AudioBufferList *bufferList,
                                                    AudioStreamPacketDescription **packetDescription,
                                                    void *context) {
  SolarisAudioConverterInput *input = context;
  if (input->consumed || input->frames == 0) {
    *packets = 0;
    return noErr;
  }
  *packets = input->frames;
  bufferList->mNumberBuffers = input->bufferList->mNumberBuffers;
  for (UInt32 index = 0; index < input->bufferList->mNumberBuffers; index++) {
    bufferList->mBuffers[index] = input->bufferList->mBuffers[index];
  }
  input->consumed = YES;
  return noErr;
}

@interface SolarisReplayKitAudioDevice () {
  id<RTCAudioDeviceDelegate> _delegate;
  dispatch_queue_t _queue;
  AudioConverterRef _converter;
  AudioStreamBasicDescription _converterInput;
  BOOL _hasConverterInput;
  NSMutableData *_pendingPCM;
  BOOL _initialized;
  BOOL _recordingInitialized;
  BOOL _recording;
  BOOL _playing;
  NSInteger _appSampleBuffers;
  int64_t _submittedFrames;
  int64_t _droppedFrames;
  NSString *_inputDescription;
}
@end

@implementation SolarisReplayKitAudioDevice

- (instancetype)init {
  self = [super init];
  if (self) {
    _queue = dispatch_queue_create("org.solaris.probe.replaykit-app-audio", DISPATCH_QUEUE_SERIAL);
    _pendingPCM = [NSMutableData data];
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
- (NSString *)inputDescription { @synchronized (self) { return _inputDescription; } }

// WebRTC asks for an audio device in 10 ms units.  Reporting stereo 48 kHz
// makes the negotiated Opus path preserve left/right channels end-to-end.
- (double)deviceInputSampleRate { return 48000.0; }
- (NSTimeInterval)inputIOBufferDuration { return 0.010; }
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
  _delegate = nil;
  _initialized = NO;
  _recordingInitialized = NO;
  _recording = NO;
  _playing = NO;
  [self stop];
  return YES;
}

// The broadcast extension sends only; returning success for playout prevents
// the native ADM from treating the lack of a local speaker as a device error.
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
  const AudioStreamBasicDescription *input = description ? CMAudioFormatDescriptionGetStreamBasicDescription(description) : NULL;
  UInt32 inputFrames = (UInt32)MAX(0, CMSampleBufferGetNumSamples(sampleBuffer));
  if (!input || inputFrames == 0 || input->mSampleRate <= 0) {
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }
  if (![self configureConverterForInput:*input]) {
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
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
      sampleBuffer, &listSize, inputList, listSize, kCFAllocatorDefault, kCFAllocatorDefault,
      kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &retainedBlock);
  if (status != noErr) {
    free(inputList);
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }

  const UInt32 outputFrames = (UInt32)ceil((double)inputFrames * 48000.0 / input->mSampleRate) + 8;
  NSMutableData *converted = [NSMutableData dataWithLength:(NSUInteger)outputFrames * 4];
  AudioBufferList outputList;
  outputList.mNumberBuffers = 1;
  outputList.mBuffers[0].mNumberChannels = 2;
  outputList.mBuffers[0].mDataByteSize = (UInt32)converted.length;
  outputList.mBuffers[0].mData = converted.mutableBytes;
  SolarisAudioConverterInput converterInput = {inputList, inputFrames, NO};
  UInt32 packets = outputFrames;
  status = AudioConverterFillComplexBuffer(_converter, SolarisAudioConverterInputCallback,
      &converterInput, &packets, &outputList, NULL);
  if (retainedBlock) CFRelease(retainedBlock);
  free(inputList);
  if (status != noErr || packets == 0) {
    @synchronized (self) { _droppedFrames += inputFrames; }
    return;
  }
  [converted setLength:(NSUInteger)packets * 4];
  [_pendingPCM appendData:converted];
  [self deliverWholeTenMillisecondFrames];
}

- (BOOL)configureConverterForInput:(AudioStreamBasicDescription)input {
  if (_hasConverterInput && memcmp(&_converterInput, &input, sizeof(input)) == 0 && _converter) return YES;
  if (_converter) { AudioConverterDispose(_converter); _converter = NULL; }
  AudioStreamBasicDescription output = {0};
  output.mSampleRate = 48000.0;
  output.mFormatID = kAudioFormatLinearPCM;
  output.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  output.mBytesPerPacket = 4;
  output.mFramesPerPacket = 1;
  output.mBytesPerFrame = 4;
  output.mChannelsPerFrame = 2;
  output.mBitsPerChannel = 16;
  OSStatus status = AudioConverterNew(&input, &output, &_converter);
  _hasConverterInput = (status == noErr && _converter != NULL);
  _converterInput = input;
  [_pendingPCM setLength:0];
  @synchronized (self) {
    _inputDescription = [NSString stringWithFormat:@"%.0fHz · %u채널 → 48kHz 스테레오", input.mSampleRate, (unsigned)input.mChannelsPerFrame];
  }
  return _hasConverterInput;
}

- (void)deliverWholeTenMillisecondFrames {
  // 48,000 Hz * 10 ms = 480 frames; 2 channels * S16 = 1,920 bytes.
  const NSUInteger chunkBytes = 480 * 2 * sizeof(int16_t);
  while (_pendingPCM.length >= chunkBytes && _recording && _delegate) {
    NSMutableData *chunk = [_pendingPCM subdataWithRange:NSMakeRange(0, chunkBytes)].mutableCopy;
    [_pendingPCM replaceBytesInRange:NSMakeRange(0, chunkBytes) withBytes:NULL length:0];
    AudioBufferList list;
    list.mNumberBuffers = 1;
    list.mBuffers[0].mNumberChannels = 2;
    list.mBuffers[0].mDataByteSize = (UInt32)chunkBytes;
    list.mBuffers[0].mData = chunk.mutableBytes;
    AudioUnitRenderActionFlags flags = 0;
    AudioTimeStamp timestamp = {0};
    OSStatus status = _delegate.deliverRecordedData(&flags, &timestamp, 1, 480, &list, NULL, nil);
    if (status == noErr) {
      @synchronized (self) { _submittedFrames += 480; }
    } else {
      @synchronized (self) { _droppedFrames += 480; }
    }
  }
}

- (void)stop {
  dispatch_sync(_queue, ^{
    [_pendingPCM setLength:0];
    if (_converter) { AudioConverterDispose(_converter); _converter = NULL; }
    _hasConverterInput = NO;
  });
}

@end
