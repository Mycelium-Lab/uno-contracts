// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 

interface IUnoAssetRouterTrisolarisStable {
    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address swap, uint256[] memory amounts, uint256 minAmountLP, uint256 amountLP, address recipient) external returns (uint256 liquidity);
    function withdraw(address swap, uint256 amount, uint256[] memory minAmounts, bool withdrawLP, address recipient) external returns (uint256[] memory amounts);

    function distribute(
        address swap,
        address[][] calldata rewardTokenRoutes,
        address[][] calldata rewarderTokenRoutes,
        uint256[][2] calldata amountsOutMin
    ) external;

    function userStake(address _address, address swap) external view returns (uint256 stakeLP);
    function totalDeposits(address swap) external view returns (uint256 totalDepositsLP);
    function getTokens(address swap) external view returns(address[] memory tokens);

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
