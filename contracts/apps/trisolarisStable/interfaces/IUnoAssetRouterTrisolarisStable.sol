// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IUnoFarmTrisolarisStable as Farm } from "./IUnoFarmTrisolarisStable.sol";
import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';

interface IUnoAssetRouterTrisolarisStable {
    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    event FeeChanged(uint256 previousFee, uint256 newFee);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);
    function fee() external view returns(uint256);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address swap, uint256[] memory amounts, uint256 minAmountLP, uint256 amountLP, address recipient) external returns (uint256 liquidity);
    function withdraw(address swap, uint256 amount, uint256[] memory minAmounts, bool withdrawLP, address recipient) external returns (uint256[] memory amounts);

    function distribute(
        address swap,
        Farm.SwapInfo[] calldata rewardSwapInfos,
        Farm.SwapInfo[] calldata rewarderSwapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external;

    function userStake(address _address, address swap) external view returns (uint256 stakeLP);
    function totalDeposits(address swap) external view returns (uint256 totalDepositsLP);
    function getTokens(address swap) external view returns(IERC20Upgradeable[] memory tokens);

    function setFee(uint256 _fee) external;

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
