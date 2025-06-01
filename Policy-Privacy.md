# Privacy Policy

**Effective Date:** 01 june, 2025

## Introduction

Aperio — Bitcoin Wallet Scanner ("the Extension") is a browser extension designed to help users quickly check the public balance of a Bitcoin address by scanning selected text on any website. This privacy policy explains what data is collected, how it is used, and how we ensure user privacy.

## Data Collection

The Extension does **not collect**, store, or transmit any personally identifiable information (PII). It operates entirely within the user's browser and only reacts to direct user interactions.

Specifically:

- The Extension does **not** track browsing history.
- The Extension does **not** read or modify the content of any webpage beyond what is necessary to detect selected Bitcoin addresses.
- The Extension does **not** collect or share any user data with third parties.

## Use of APIs

To retrieve balance information, the Extension makes a public API call to:

`https://blockchain.info/balance?active=<bitcoin_address>`

This request is made client-side, directly from the user's browser. No data is routed through external servers controlled by the developer.

## Permissions

The Extension requests the following permissions:

- `activeTab`: Used to access the currently active page and detect selected text.
- `scripting`: Used to inject the necessary script that enables scanning functionality.
- `host_permissions` (`https://blockchain.info/*`): Used to query the balance of Bitcoin addresses through a public API.

These permissions are limited in scope and are used exclusively to support the core functionality of the Extension.

## Data Security

Since the Extension does not store or transmit data, there is no personal information at risk. All processes occur locally in the browser environment.

## Changes to This Policy

This policy may be updated if functionality changes. Users are encouraged to review the privacy policy periodically for updates.

## Contact

If you have any questions or concerns regarding this privacy policy, feel free to contact the developer:

**Made with ❤️ by Mickey Boreal**  
[GitHub Repository](https://github.com/AperioScanner/Crypto-Scanner-Blockhain)
