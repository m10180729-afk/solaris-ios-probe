// Original build54 policy functions, Git 4c50dbe. Keep their bodies unchanged.
const log=message=>console.warn(message);
export const BUILD54_DESKTOP_MODE=Object.freeze({id:'hardware60',label:'Solaris 하드웨어 1080p60',fps:60,startKbps:12000,minKbps:4000,maxKbps:28000,maxBitrate:28000000,degradationPreference:'maintain-framerate',transport:'native-rtp'});
const selectedMode=BUILD54_DESKTOP_MODE;

export function mediaCodecs(kind){
  const caps=(kind==='sender'?RTCRtpSender:RTCRtpReceiver).getCapabilities?.('video')?.codecs||[];
  const h264=caps.filter(c=>(c.mimeType||'').toLowerCase()==='video/h264');
  if(!h264.length)throw Error('H.264 WebRTC 코덱을 사용할 수 없습니다. 최신 Edge/Chrome과 GPU 드라이버를 사용하세요.');
  return[...h264,...caps.filter(c=>/\/(rtx|red|ulpfec|flexfec-03)$/i.test(c.mimeType||''))];
}

export function tuneDesktopSDP(sdp,mode=selectedMode){
  const lines=sdp.replace(/\r\n/g,'\n').split('\n');let inVideo=false,inAudio=false;
  const h264=new Set(),opus=new Set();
  for(const line of lines){if(line.startsWith('m=')){inVideo=line.startsWith('m=video ');inAudio=line.startsWith('m=audio ');}let m=inVideo&&line.match(/^a=rtpmap:(\d+) H264\/90000$/i);if(m)h264.add(m[1]);m=inAudio&&line.match(/^a=rtpmap:(\d+) opus\/48000\/2$/i);if(m)opus.add(m[1]);}
  inVideo=false;inAudio=false;const out=[];
  for(const line of lines){
    if(line.startsWith('m=')){inVideo=line.startsWith('m=video ');inAudio=line.startsWith('m=audio ');}
    if((inVideo||inAudio)&&/^b=(AS|TIAS):/.test(line))continue;
    const audioFmtp=inAudio&&line.match(/^a=fmtp:(\d+) /i);if(audioFmtp&&opus.has(audioFmtp[1]))continue;
    let tuned=line;const fmtp=inVideo&&line.match(/^a=fmtp:(\d+) (.+)$/i);
    if(fmtp&&h264.has(fmtp[1])){
      const base=fmtp[2].replace(/profile-level-id=([0-9a-f]{4})[0-9a-f]{2}/i,(_m,p)=>`profile-level-id=${p}33`)
        .replace(/;(x-google-(start|min|max)-bitrate)=\d+/gi,'');
      tuned=`a=fmtp:${fmtp[1]} ${base};x-google-start-bitrate=${mode.startKbps};x-google-min-bitrate=${mode.minKbps};x-google-max-bitrate=${mode.maxKbps}`;
    }
    out.push(tuned);
    if(inVideo&&line.startsWith('c=')){out.push(`b=AS:${mode.maxKbps}`);out.push(`b=TIAS:${mode.maxBitrate}`);}
    if(inAudio&&line.startsWith('c=')){out.push('b=AS:256');out.push('b=TIAS:256000');}
    const op=inAudio&&line.match(/^a=rtpmap:(\d+) opus\/48000\/2$/i);if(op&&opus.has(op[1]))out.push(`a=fmtp:${op[1]} stereo=1;sprop-stereo=1;maxaveragebitrate=256000;maxplaybackrate=48000;useinbandfec=1`);
  }
  return out.join('\r\n');
}

export async function applySenderPolicy(sender,mode=selectedMode){
  const configure=(p,extended)=>{
    if(!p.encodings?.length)p.encodings=[{}];
    for(const e of p.encodings){e.active=true;e.maxBitrate=mode.maxBitrate;e.maxFramerate=mode.fps;e.scaleResolutionDownBy=1;if(extended){e.priority='high';e.networkPriority='high';}}
    if(extended)p.degradationPreference=mode.degradationPreference;
    return p;
  };
  try{await sender.setParameters(configure(sender.getParameters(),true));}
  catch(firstError){
    log(`브라우저가 확장 RTP 정책 일부를 거부하여 핵심 ${mode.label} 정책으로 재시도: `+firstError.message);
    await sender.setParameters(configure(sender.getParameters(),false));
  }
}

export function tuneScreenOfferSDP(sdp){
  // Actual CRLF, not literal backslash-r/backslash-n as in build19.
  const lines=sdp.replace(/\r\n/g,'\n').split('\n');
  const h264Payloads=new Set();
  const opusPayloads=new Set();
  let videoSection=false,audioSection=false;
  for(const line of lines){
    if(line.startsWith('m=')) { videoSection=line.startsWith('m=video ');audioSection=line.startsWith('m=audio '); }
    const match=videoSection&&line.match(/^a=rtpmap:(\d+) H264\/90000$/i);
    if(match) h264Payloads.add(match[1]);
    const opus=audioSection&&line.match(/^a=rtpmap:(\d+) opus\/48000\/2$/i);
    if(opus) opusPayloads.add(opus[1]);
  }
  let inVideo=false,inAudio=false;
  const out=[];
  for(const line of lines){
    if(line.startsWith('m=')) { inVideo=line.startsWith('m=video ');inAudio=line.startsWith('m=audio '); }
    if((inVideo||inAudio) && /^b=(AS|TIAS):/.test(line)) continue;
    const audioFmtp=inAudio&&line.match(/^a=fmtp:(\d+) (.+)$/i);
    if(audioFmtp&&opusPayloads.has(audioFmtp[1])) continue;
    let tuned=line;
    const fmtp=inVideo&&line.match(/^a=fmtp:(\d+) (.+)$/i);
    if(fmtp&&h264Payloads.has(fmtp[1])) {
      // Chromium advertises H.264 level 3.1 (..1f) even when the Windows
      // hardware decoder can receive the native iPad frame.  1920x1324@60
      // needs level 5.1: 9,960 macroblocks/frame and 597,600 macroblocks/s.
      // Leaving 3.1 negotiated makes VideoToolbox reject every frame, which
      // is exactly the build23 encodedFrames=0 failure.
      const parameters=fmtp[2].replace(/profile-level-id=([0-9a-f]{4})[0-9a-f]{2}/i,
        (_match,prefix)=>`profile-level-id=${prefix}33`);
      tuned=`a=fmtp:${fmtp[1]} ${parameters}`;
    }
    out.push(tuned);
    if(inVideo && line.startsWith('c=')){
      out.push('b=AS:60000');
      out.push('b=TIAS:60000000');
    }
    if(inAudio && line.startsWith('c=')){
      out.push('b=AS:256');
      out.push('b=TIAS:256000');
    }
    const opusRtpmap=inAudio&&line.match(/^a=rtpmap:(\d+) opus\/48000\/2$/i);
    if(opusRtpmap&&opusPayloads.has(opusRtpmap[1])) {
      // Stereo must be negotiated by both ends.  Opus remains lossy by design,
      // but 48 kHz / 256 kbps avoids the telephone-call processing profile.
      out.push(`a=fmtp:${opusRtpmap[1]} stereo=1;sprop-stereo=1;maxaveragebitrate=256000;maxplaybackrate=48000;useinbandfec=1`);
    }
  }
  // RTX apt stays untouched; H.264 level and Opus stereo are explicit.
  return out.join('\r\n');
}

export function selectCodecs(transceiver,mode){
  try {
    if(!transceiver || typeof transceiver.setCodecPreferences!=='function' ||
       typeof RTCRtpReceiver==='undefined' || typeof RTCRtpReceiver.getCapabilities!=='function') {
      throw Error('이 브라우저는 코덱 고정을 지원하지 않습니다. 최신 Edge 또는 Chrome을 사용하세요.');
    }
    const codecs=RTCRtpReceiver.getCapabilities('video')?.codecs||[];
    const wanted=mode==='vp8'?'video/vp8':'video/h264';
    const preferred=codecs.filter(c=>(c.mimeType||'').toLowerCase()===wanted);
    if(!preferred.length) throw Error(`${wanted.replace('video/','').toUpperCase()} 코덱을 사용할 수 없습니다.`);
    const repair=codecs.filter(c=>/\/(rtx|red|ulpfec|flexfec-03)$/i.test(c.mimeType||''));
    // "Preferred" still allowed build23 to negotiate VP8/libvpx. Include only
    // the requested media codec (plus packet-repair codecs), making the offer
    // incapable of silently selecting another encoder.
    transceiver.setCodecPreferences([...preferred,...repair]);
    return mode==='vp8'?'VP8 software compatibility':'H264 only (hardware required)';
  } catch(e) {
    log(`코덱 설정 실패: ${e.message}`);
    throw e;
  }
}

export function selectAudioCodecs(transceiver){
  try {
    if(!transceiver || typeof transceiver.setCodecPreferences!=='function' ||
       typeof RTCRtpReceiver==='undefined' || typeof RTCRtpReceiver.getCapabilities!=='function') {
      throw Error('이 브라우저는 오디오 코덱 고정을 지원하지 않습니다. 최신 Edge 또는 Chrome을 사용하세요.');
    }
    const codecs=RTCRtpReceiver.getCapabilities('audio')?.codecs||[];
    const opus=codecs.filter(c=>(c.mimeType||'').toLowerCase()==='audio/opus');
    if(!opus.length) throw Error('Opus 코덱을 사용할 수 없습니다.');
    transceiver.setCodecPreferences(opus);
    return 'Opus 48kHz stereo · 256kbps';
  } catch(e) {
    log(`화면 소리 코덱 설정 실패: ${e.message}`);
    throw e;
  }
}
