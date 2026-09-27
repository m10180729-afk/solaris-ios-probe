#import "SolarisH264DisplayView.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>

@interface SolarisH264DisplayView ()
@property(nonatomic) CMVideoFormatDescriptionRef formatDescription;
@property(nonatomic, strong) NSData *sps;
@property(nonatomic, strong) NSData *pps;
@property(nonatomic, readwrite) NSInteger decodedFrames;
@property(nonatomic, readwrite) NSInteger droppedFrames;
@property(nonatomic, copy, readwrite) NSString *lastError;
@end

@implementation SolarisH264DisplayView

+ (Class)layerClass { return [AVSampleBufferDisplayLayer class]; }

- (AVSampleBufferDisplayLayer *)displayLayer {
    return (AVSampleBufferDisplayLayer *)self.layer;
}

- (instancetype)initWithFrame:(CGRect)frame {
    self = [super initWithFrame:frame];
    if (self) {
        self.backgroundColor = UIColor.blackColor;
        self.lastError = @"";
        self.displayLayer.videoGravity = AVLayerVideoGravityResizeAspect;
    }
    return self;
}

- (void)dealloc {
    if (_formatDescription != NULL) CFRelease(_formatDescription);
}

- (void)resetDecoder {
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.displayLayer flushAndRemoveImage];
        if (self->_formatDescription != NULL) {
            CFRelease(self->_formatDescription);
            self->_formatDescription = NULL;
        }
        self.sps = nil;
        self.pps = nil;
        self.decodedFrames = 0;
        self.droppedFrames = 0;
        self.lastError = @"";
    });
}

static NSArray<NSData *> *SolarisNALUnits(NSData *annexB) {
    const uint8_t *bytes = annexB.bytes;
    NSUInteger length = annexB.length;
    NSMutableArray<NSNumber *> *prefixes = [NSMutableArray array];
    NSMutableArray<NSNumber *> *payloads = [NSMutableArray array];
    for (NSUInteger i = 0; i + 3 < length;) {
        NSUInteger prefix = 0;
        if (bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 1) prefix = 3;
        else if (i + 4 <= length && bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 0 && bytes[i + 3] == 1) prefix = 4;
        if (prefix > 0) {
            [prefixes addObject:@(i)];
            [payloads addObject:@(i + prefix)];
            i += prefix;
        } else {
            i++;
        }
    }
    if (payloads.count == 0) return @[];
    NSMutableArray<NSData *> *units = [NSMutableArray arrayWithCapacity:payloads.count];
    for (NSUInteger index = 0; index < payloads.count; index++) {
        NSUInteger start = payloads[index].unsignedIntegerValue;
        NSUInteger end = index + 1 < prefixes.count ? prefixes[index + 1].unsignedIntegerValue : length;
        while (end > start && bytes[end - 1] == 0) end--;
        if (end > start) [units addObject:[annexB subdataWithRange:NSMakeRange(start, end - start)]];
    }
    return units;
}

- (BOOL)updateFormatFromUnits:(NSArray<NSData *> *)units {
    for (NSData *unit in units) {
        if (unit.length == 0) continue;
        uint8_t type = ((const uint8_t *)unit.bytes)[0] & 0x1F;
        if (type == 7) self.sps = unit;
        else if (type == 8) self.pps = unit;
    }
    if (!self.sps || !self.pps) return self.formatDescription != NULL;
    if (self.formatDescription != NULL) return YES;
    const uint8_t *parameterSets[2] = { self.sps.bytes, self.pps.bytes };
    const size_t sizes[2] = { self.sps.length, self.pps.length };
    OSStatus status = CMVideoFormatDescriptionCreateFromH264ParameterSets(
        kCFAllocatorDefault, 2, parameterSets, sizes, 4, &_formatDescription);
    if (status != noErr) {
        self.lastError = [NSString stringWithFormat:@"H.264 형식 생성 실패: %d", (int)status];
        return NO;
    }
    return YES;
}

- (void)enqueueAnnexBFrame:(NSData *)data
       presentationTimeUs:(int64_t)presentationTimeUs
                  keyFrame:(BOOL)keyFrame {
    if (data.length == 0) return;
    NSArray<NSData *> *units = SolarisNALUnits(data);
    if (units.count == 0 || ![self updateFormatFromUnits:units]) {
        self.droppedFrames++;
        return;
    }
    NSMutableData *avcc = [NSMutableData dataWithCapacity:data.length];
    BOOL hasPicture = NO;
    for (NSData *unit in units) {
        if (unit.length == 0) continue;
        uint8_t type = ((const uint8_t *)unit.bytes)[0] & 0x1F;
        if (type == 7 || type == 8 || type == 9) continue;
        if (type == 1 || type == 5) hasPicture = YES;
        uint32_t size = CFSwapInt32HostToBig((uint32_t)unit.length);
        [avcc appendBytes:&size length:sizeof(size)];
        [avcc appendData:unit];
    }
    if (!hasPicture || avcc.length == 0) {
        self.droppedFrames++;
        return;
    }

    CMBlockBufferRef block = NULL;
    OSStatus status = CMBlockBufferCreateWithMemoryBlock(
        kCFAllocatorDefault, NULL, avcc.length, kCFAllocatorDefault, NULL, 0,
        avcc.length, 0, &block);
    if (status == noErr) status = CMBlockBufferReplaceDataBytes(avcc.bytes, block, 0, avcc.length);
    if (status != noErr || block == NULL) {
        if (block) CFRelease(block);
        self.droppedFrames++;
        self.lastError = [NSString stringWithFormat:@"H.264 버퍼 생성 실패: %d", (int)status];
        return;
    }

    CMSampleTimingInfo timing = {
        .duration = kCMTimeInvalid,
        .presentationTimeStamp = CMTimeMake(presentationTimeUs, 1000000),
        .decodeTimeStamp = kCMTimeInvalid
    };
    CMSampleBufferRef sample = NULL;
    const size_t sampleSize = avcc.length;
    status = CMSampleBufferCreateReady(kCFAllocatorDefault, block,
                                       self.formatDescription, 1, 1, &timing,
                                       1, &sampleSize, &sample);
    CFRelease(block);
    if (status != noErr || sample == NULL) {
        if (sample) CFRelease(sample);
        self.droppedFrames++;
        self.lastError = [NSString stringWithFormat:@"H.264 샘플 생성 실패: %d", (int)status];
        return;
    }
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample, true);
    if (attachments && CFArrayGetCount(attachments) > 0) {
        CFMutableDictionaryRef dictionary = (CFMutableDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
        CFDictionarySetValue(dictionary, kCMSampleAttachmentKey_DisplayImmediately, kCFBooleanTrue);
        if (keyFrame) CFDictionaryRemoveValue(dictionary, kCMSampleAttachmentKey_NotSync);
    }
    CFRetain(sample);
    dispatch_async(dispatch_get_main_queue(), ^{
        AVSampleBufferDisplayLayer *layer = self.displayLayer;
        if (layer.status == AVQueuedSampleBufferRenderingStatusFailed) [layer flush];
        if (layer.isReadyForMoreMediaData) {
            [layer enqueueSampleBuffer:sample];
            self.decodedFrames++;
            self.lastError = @"";
        } else {
            self.droppedFrames++;
        }
        CFRelease(sample);
    });
    CFRelease(sample);
}

@end
