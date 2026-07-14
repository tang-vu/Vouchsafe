# Confidential Space Live Run — Evidence (14 Jul 2026)

The Vouchsafe TEE extension ran inside a real **GCP Confidential Space** enclave (production image,
debug disabled) and recorded a solvency attestation on Coston2 with a key generated in-enclave.

## On-chain evidence (permanent)
- recordSolvency (enclave-signed): https://coston2-explorer.flare.network/tx/0x8f0595ba1a94b29988df6e9bb139a5cbe8c94f4c580dbc23fefe3ed641202d47
- attestation id: 0xb9a64577b52a93344eb468015cbd4a68c26bcedfcedd83d0b2aeef70d06130df
- quorum endorse tx: https://coston2-explorer.flare.network/tx/0x8ccb9e95405a61ab206ee4e78d6a53bda8d16841fd308ec94247194ddd101ba4
- enclave signer (in-enclave key, never exported): 0x8dCdC4017e4a65BB2e0266E8CD26aA7C10bA9E51
- image: us-central1-docker.pkg.dev/project-39a2a64c-cc70-4685-829/vouchsafe/tee-extension@sha256:848c6b6254f4ecad2e090fcbc93052c3bbdbf5cce5f14860f600ca87ea6e959c
- VM: vouchsafe-tee, us-central1-b, n2d-standard-2, AMD SEV, secure boot
- fraud act: skipped by design (a real enclave will not sign a false claim)

## Attestation token claims (decoded; Google-signed, iss confidentialcomputing.googleapis.com)

```json
{
  "aud": "https://sts.googleapis.com",
  "exp": 1784018502,
  "iat": 1784014902,
  "iss": "https://confidentialcomputing.googleapis.com",
  "nbf": 1784014902,
  "sub": "https://www.googleapis.com/compute/v1/projects/project-39a2a64c-cc70-4685-829/zones/us-central1-b/instances/vouchsafe-tee",
  "eat_profile": "https://cloud.google.com/confidential-computing/confidential-space/docs/reference/token-claims",
  "secboot": true,
  "oemid": 11129,
  "hwmodel": "GCP_AMD_SEV",
  "swname": "CONFIDENTIAL_SPACE",
  "swversion": [
    "260600"
  ],
  "dbgstat": "disabled-since-boot",
  "submods": {
    "confidential_space": {
      "support_attributes": [
        "LATEST",
        "STABLE",
        "USABLE"
      ],
      "monitoring_enabled": {
        "memory": false
      }
    },
    "container": {
      "image_reference": "us-central1-docker.pkg.dev/project-39a2a64c-cc70-4685-829/vouchsafe/tee-extension@sha256:848c6b6254f4ecad2e090fcbc93052c3bbdbf5cce5f14860f600ca87ea6e959c",
      "image_digest": "sha256:848c6b6254f4ecad2e090fcbc93052c3bbdbf5cce5f14860f600ca87ea6e959c",
      "restart_policy": "Never",
      "image_id": "sha256:11c28ed3507c12c978c67a8ef99ecd403aeae61c3c862ff8e647cc54fca24525",
      "env": {
        "HOSTNAME": "vouchsafe-tee",
        "MODE": "0",
        "NODE_ENV": "production",
        "NODE_VERSION": "24.18.0",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "SIMULATED_TEE": "false",
        "TEE_EXTENSION_PORT": "7800",
        "YARN_VERSION": "1.22.22"
      },
      "args": [
        "docker-entrypoint.sh",
        "node",
        "dist/index.js"
      ]
    },
    "gce": {
      "zone": "us-central1-b",
      "project_id": "project-39a2a64c-cc70-4685-829",
      "project_number": "119354020768",
      "instance_name": "vouchsafe-tee",
      "instance_id": "7757650102930921744"
    }
  },
  "google_service_accounts": [
    "vouchsafe-cs@project-39a2a64c-cc70-4685-829.iam.gserviceaccount.com"
  ]
}
```

## Raw JWT (expired after 1h — signature remains verifiable against Google JWKS at time of issue)

```
eyJhbGciOiJSUzI1NiIsImtpZCI6ImI5MmViOWE5ZmQzMWI2MTY1NmJlOWNlMjI0NWIxNDFjODE0YTA5YWQiLCJ0eXAiOiJKV1QifQ.eyJhdWQiOiJodHRwczovL3N0cy5nb29nbGVhcGlzLmNvbSIsImV4cCI6MTc4NDAxODUwMiwiaWF0IjoxNzg0MDE0OTAyLCJpc3MiOiJodHRwczovL2NvbmZpZGVudGlhbGNvbXB1dGluZy5nb29nbGVhcGlzLmNvbSIsIm5iZiI6MTc4NDAxNDkwMiwic3ViIjoiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vY29tcHV0ZS92MS9wcm9qZWN0cy9wcm9qZWN0LTM5YTJhNjRjLWNjNzAtNDY4NS04Mjkvem9uZXMvdXMtY2VudHJhbDEtYi9pbnN0YW5jZXMvdm91Y2hzYWZlLXRlZSIsImVhdF9wcm9maWxlIjoiaHR0cHM6Ly9jbG91ZC5nb29nbGUuY29tL2NvbmZpZGVudGlhbC1jb21wdXRpbmcvY29uZmlkZW50aWFsLXNwYWNlL2RvY3MvcmVmZXJlbmNlL3Rva2VuLWNsYWltcyIsInNlY2Jvb3QiOnRydWUsIm9lbWlkIjoxMTEyOSwiaHdtb2RlbCI6IkdDUF9BTURfU0VWIiwic3duYW1lIjoiQ09ORklERU5USUFMX1NQQUNFIiwic3d2ZXJzaW9uIjpbIjI2MDYwMCJdLCJkYmdzdGF0IjoiZGlzYWJsZWQtc2luY2UtYm9vdCIsInN1Ym1vZHMiOnsiY29uZmlkZW50aWFsX3NwYWNlIjp7InN1cHBvcnRfYXR0cmlidXRlcyI6WyJMQVRFU1QiLCJTVEFCTEUiLCJVU0FCTEUiXSwibW9uaXRvcmluZ19lbmFibGVkIjp7Im1lbW9yeSI6ZmFsc2V9fSwiY29udGFpbmVyIjp7ImltYWdlX3JlZmVyZW5jZSI6InVzLWNlbnRyYWwxLWRvY2tlci5wa2cuZGV2L3Byb2plY3QtMzlhMmE2NGMtY2M3MC00Njg1LTgyOS92b3VjaHNhZmUvdGVlLWV4dGVuc2lvbkBzaGEyNTY6ODQ4YzZiNjI1NGY0ZWNhZDJlMDkwZmNiYzkzMDUyYzNiYmRiZjVjY2U1ZjE0ODYwZjYwMGNhODdlYTZlOTU5YyIsImltYWdlX2RpZ2VzdCI6InNoYTI1Njo4NDhjNmI2MjU0ZjRlY2FkMmUwOTBmY2JjOTMwNTJjM2JiZGJmNWNjZTVmMTQ4NjBmNjAwY2E4N2VhNmU5NTljIiwicmVzdGFydF9wb2xpY3kiOiJOZXZlciIsImltYWdlX2lkIjoic2hhMjU2OjExYzI4ZWQzNTA3YzEyYzk3OGM2N2E4ZWY5OWVjZDQwM2FlYWU2MWMzYzg2MmZmOGU2NDdjYzU0ZmNhMjQ1MjUiLCJlbnYiOnsiSE9TVE5BTUUiOiJ2b3VjaHNhZmUtdGVlIiwiTU9ERSI6IjAiLCJOT0RFX0VOViI6InByb2R1Y3Rpb24iLCJOT0RFX1ZFUlNJT04iOiIyNC4xOC4wIiwiUEFUSCI6Ii91c3IvbG9jYWwvc2JpbjovdXNyL2xvY2FsL2JpbjovdXNyL3NiaW46L3Vzci9iaW46L3NiaW46L2JpbiIsIlNJTVVMQVRFRF9URUUiOiJmYWxzZSIsIlRFRV9FWFRFTlNJT05fUE9SVCI6Ijc4MDAiLCJZQVJOX1ZFUlNJT04iOiIxLjIyLjIyIn0sImFyZ3MiOlsiZG9ja2VyLWVudHJ5cG9pbnQuc2giLCJub2RlIiwiZGlzdC9pbmRleC5qcyJdfSwiZ2NlIjp7InpvbmUiOiJ1cy1jZW50cmFsMS1iIiwicHJvamVjdF9pZCI6InByb2plY3QtMzlhMmE2NGMtY2M3MC00Njg1LTgyOSIsInByb2plY3RfbnVtYmVyIjoiMTE5MzU0MDIwNzY4IiwiaW5zdGFuY2VfbmFtZSI6InZvdWNoc2FmZS10ZWUiLCJpbnN0YW5jZV9pZCI6Ijc3NTc2NTAxMDI5MzA5MjE3NDQifX0sImdvb2dsZV9zZXJ2aWNlX2FjY291bnRzIjpbInZvdWNoc2FmZS1jc0Bwcm9qZWN0LTM5YTJhNjRjLWNjNzAtNDY4NS04MjkuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iXX0.IwEQUHUhc5i2Lv4vvVZjdOpwzULv7ck7b9-wHg2EDlr6ZBjsnqkJSvgtywsanMhbQSghNIrcYttlHf5Iy2ZaGnfqcKsOpT7RYGlA7klP6g0nafD61EwEneSvaHtf7Mg-FhFg9Ax9sNR7dZd2P9eW-PSQX6l6kZbi0pLcsrhJ_RTPX8dig7jI7fJ8h62L4-42GvIO6WonOeAusYeNX7yElzfy0LM9GsUoaGYKHKrOVMVIYlY2xHQU0t1HirovkwtXJuOtqF_AbDlXSCZF09MqCsnSPTEQNe6Zg5B5rHhLn-wHozND1495tkA0p5TSRD9TkatzZ9-Llx7QeW0p-on8-w
```
