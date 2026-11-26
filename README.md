# Nearby — Wi-Fi File Transfer

Nearby is a small, private file-sharing app for moving files between a laptop, tablet, and phone on the same Wi-Fi network or personal hotspot. One device runs the app; everyone else opens its local address in a browser. Files go directly over the local network and are saved on the device running the app—there is no account, cloud storage, or external transfer service.

## Requirements

- Node.js 18 or newer
- Both devices connected to the same Wi-Fi network or hotspot

## Start the app

```sh
npm start
```

The terminal prints the local addresses to open on the other device, such as `http://192.168.1.23:8787`. On the laptop running the app, `http://localhost:8787` also works. If your firewall prompts you, allow Node.js on your private network. Use a trusted network: the app is intended for devices on your local Wi-Fi and does not require a login.

Use the page to browse for or drag files onto the upload area. Received files appear in the shared list and can be downloaded or deleted from either device. You can also send a file from the second device back to the laptop—the same page works in both directions. Transfers are stored in the `transfers` folder beside the app by default.

## Options

- `PORT=9000 npm start` changes the listening port.
- `TRANSFER_DIR=/path/to/folder npm start` (or a Windows path) changes where received files are stored.

## Run tests

```sh
npm test
```
