// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IAssetManager} from "@flarenetwork/flare-periphery-contracts/coston2/IAssetManager.sol";
import {IAgentOwnerRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/IAgentOwnerRegistry.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";

/**
 * @title FxrpAgentBinding
 * @notice Read-only bridge to the FAssets FXRP system, used to bind a Vouchsafe attestation to a real
 *         FXRP agent. Resolves the FXRP AssetManager and agent metadata entirely through the
 *         FlareContractRegistry — no hardcoded addresses.
 */
contract FxrpAgentBinding {
    /// @notice The FXRP AssetManager address, resolved via the registry.
    function assetManager() public view returns (address) {
        return address(ContractRegistry.getAssetManagerFXRP());
    }

    /// @notice The AgentOwnerRegistry that holds agent metadata, per the AssetManager settings.
    function agentOwnerRegistry() public view returns (IAgentOwnerRegistry) {
        return IAgentOwnerRegistry(ContractRegistry.getAssetManagerFXRP().getSettings().agentOwnerRegistry);
    }

    /// @notice Agent display metadata by management address.
    function getAgentDetails(address managementAddress)
        external
        view
        returns (string memory name, string memory description, string memory iconUrl, string memory termsOfUseUrl)
    {
        IAgentOwnerRegistry reg = agentOwnerRegistry();
        return (
            reg.getAgentName(managementAddress),
            reg.getAgentDescription(managementAddress),
            reg.getAgentIconUrl(managementAddress),
            reg.getAgentTermsOfUseUrl(managementAddress)
        );
    }
}
