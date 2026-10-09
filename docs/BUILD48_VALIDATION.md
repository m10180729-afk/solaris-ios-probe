# build48: Windows→iPad interruption investigation

The build47 Windows sender session `6ba18ba9-8071-44fb-bde6-5007c31f56d3` reported a candidate-pair outgoing bitrate estimate between 0.1 and 0.26Mbps, RTT rising past 1–2 seconds, 487 dropped access units, and encoder restarts from 12 to 7 to 4Mbps. This estimate is not an independent physical bandwidth measurement, and no iPad diagnostic was attached for that exact session.

build48 refreshes the iPad H.264 format description on an actual SPS/PPS change, resets stale encoded-FPS display across stops/restarts, and reports local/remote ICE candidate types and protocol (without IP addresses) to identify the connection route. It retains the build47 queue and encoder-priority changes. No packet transport or multi-viewer architecture is replaced in this build.

Acceptance still requires the Windows Action self-test, the iOS build, and a paired real-device diagnostic with matching session IDs. If the candidate-pair bitrate estimate remains below 2Mbps with high RTT, inspect the selected route, network load and both devices' connectivity before judging the codec or changing its bitrate. A stable 1080p60 claim requires receiver frame and loss measurements under motion for a sustained run.
