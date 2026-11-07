# Intel Mac CloudKit stapling failure

## Match

[actions/runner-images#14924](https://github.com/actions/runner-images/issues/14924) reports failures on `macos-15-intel` at Apple's CloudKit ticket endpoint with `NSURLErrorDomain -1005` and stapler Error 68. [SWCC's v0.2.0 release run](https://github.com/andreaskinga-lgtm/SWCC/actions/runs/42327055452) has the same runner, endpoint and errors: the first attempt passed strict signature verification and failed ticket validation; subsequent attempts failed during automatic stapling.

This is an exact symptom match, not proof of the same underlying transport failure. [The runner-images maintainers](https://github.com/actions/runner-images/issues/14924#issuecomment-6188826956) reproduced dropped HTTP/3 traffic over UDP 443 and reported successful stapling after blocking it. Their [diagnostic workflow](https://github.com/actions/runner-images/blob/bab74e87e4170a3bdeb209dc2e68394354e454bf/.github/workflows/debug-14924-cloudkit.yml#L105-L147) tests a different application; SWCC's logs do not identify the transport protocol.

## Workflow workaround

The release workflow applies the maintainers' workaround only on the ephemeral Intel Mac runner, before packaging:

```yaml
- name: Work around CloudKit HTTP/3 failures on Intel Macs
  if: matrix.platform == 'mac' && matrix.arch == 'x64'
  run: |
    echo "block return out quick proto udp from any to any port 443" | sudo pfctl -f -
    sudo pfctl -E
```

The [maintainer comment](https://github.com/actions/runner-images/issues/14924#issuecomment-6188826956) reports that blocking UDP 443 lets the request succeed over TCP. HTTP/3 uses QUIC, which runs over UDP ([RFC 9114](https://www.rfc-editor.org/rfc/rfc9114.html#section-1.2), [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000.html#section-1)). Do not run these firewall commands on a developer's Mac.

Placement before packaging matters: SWCC [enables notarization](https://github.com/andreaskinga-lgtm/SWCC/blob/v0.2.0/package.json#L80-L88), and [electron-builder staples during notarization](https://www.electron.build/v26/docs/notarization/#how-stapling-works), before SWCC's separate verification step.

## Acceptance

Keep forced code signing, credential checks, strict `codesign` verification, `xcrun stapler validate`, Gatekeeper assessment and packaged-app smoke tests unchanged ([release workflow](https://github.com/andreaskinga-lgtm/SWCC/blob/v0.2.0/.github/workflows/release.yml#L91-L135)). Only a build passing those gates establishes that the workaround works for SWCC. Signing and the notarization ticket are distinct safeguards ([Apple documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)).
