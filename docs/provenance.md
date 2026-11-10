# Reference and code provenance

## OMP: behavioral/UI reference, not a port

The inventory references [can1357/oh-my-pi at eda28eff97cf7a352fd3057a03581be1686dbc7a](https://github.com/can1357/oh-my-pi/tree/eda28eff97cf7a352fd3057a03581be1686dbc7a). Source and test files were fetched read-only through GitHub's tree API and raw-file service. No OMP implementation, prompts, fixtures, native libraries or runtime packages are included. The inventory describes observable contracts; it does not assert a Pi module is equivalent because its name matches OMP.

## Pi: public API examples and facilities

The extension/coordinator/tests are Pi-native code. The complete-resource-loader object in `src/coordinator.ts` is adapted from Pi's published [12-full-control.ts example at v1.5.2](https://github.com/earendil-works/pi/blob/b4afdddf44e059c67ccf5097e5317d913521b470/packages/coding-agent/examples/sdk/12-full-control.ts). The loader method names/empty-return shapes implement Pi's public `ResourceLoader` interface. Attribution and the MIT notice are preserved in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Session creation/storage, streaming, extension lifecycle and overlay usage follow the corresponding Pi 1.5.2 SDK/extension/TUI documentation and examples; those facilities are consumed as dependencies, not extracted into this package. The controlled provider is Pi's public `fauxProvider`/`fauxAssistantMessage`, not an independently implemented model or a production provider. Installed test dependencies are resolved normally from npm with a lockfile; nothing is symlinked from another checkout.

No Woostack product/source code or pi-subagents implementation is inherited. Workflow documentation informed the execution process only. This document does not select a license for newly authored repository code; upstream dependency/example licenses remain their own.
