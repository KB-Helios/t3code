# Self-hosted iOS push

Each NorthBridgeCode environment stores its own mobile installations and sends its own APNs notifications and Live Activity updates. Push delivery is disabled unless all operator-owned values below are present:

- `T3CODE_APNS_TEAM_ID`: Apple Developer team ID.
- `T3CODE_APNS_KEY_ID`: APNs signing key ID.
- `T3CODE_APNS_PRIVATE_KEY_PATH`: path to the APNs `.p8` private key on the server host.
- `T3CODE_APNS_TOPIC`: installed mobile app bundle ID, normally
  `com.kbhelios.northbridgecode` for production.
- `T3CODE_APNS_ENVIRONMENT`: `development` for sandbox APNs tokens or `production` for distribution builds.

Restart the environment after changing these values. An incomplete configuration leaves the server and mobile clients operational; registration reports that push is unavailable until configuration is complete.
