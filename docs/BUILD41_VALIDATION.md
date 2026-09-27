# Build41 validation

- build40's direct H.264 sender demanded only the WebCodecs Annex-B output mode.
- build41 probes constrained-baseline, main, and high H.264 profiles at the selected frame rate.
- It probes both Annex-B and AVC/AVCC output formats.
- AVC/AVCC output is converted to Annex-B before Solaris sends it to the existing iPad VideoToolbox surface.
- Windows diagnostics record every attempted H.264 configuration and the selected packet format.

This corrects the case where Edge reports hardware video encoding but WebView2 rejects the Annex-B-only WebCodecs probe. Physical-device performance remains to be verified after the Actions build.
