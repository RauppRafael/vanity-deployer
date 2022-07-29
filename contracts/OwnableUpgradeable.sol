// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable-v4/access/OwnableUpgradeable.sol" as OzOwnableUpgradeable;
import "@openzeppelin/contracts-upgradeable-v4/proxy/utils/UUPSUpgradeable.sol";

abstract contract OwnableUpgradeable is OzOwnableUpgradeable.OwnableUpgradeable, UUPSUpgradeable {
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
