// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.18;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract VanityDeployer is OwnableUpgradeable, UUPSUpgradeable {
    event DeployedContract(address indexed contractAddress, bool proxy);

    function initialize(address _owner) initializer virtual public {
        __Ownable_init();

        transferOwnership(_owner);
    }

    function deployContract(
        bytes memory code,
        bytes32 salt
    ) public onlyOwner {
        address addr;

        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {revert(0, 0)}
        }

        emit DeployedContract(addr, false);
    }

    function deployContractAndInitialize(
        bytes memory code,
        bytes32 salt,
        bytes memory initializer
    ) public onlyOwner {
        address addr;

        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
            if iszero(extcodesize(addr)) {revert(0, 0)}
        }

        (bool success,) = addr.call(initializer);

        require(success, "Deployer:: Contract initialization failed");

        emit DeployedContract(addr, true);
    }

    function getAddress(
        bytes memory code,
        uint _salt
    ) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff), address(this), _salt, keccak256(code)
            )
        );

        return address(uint160(uint(hash)));
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
