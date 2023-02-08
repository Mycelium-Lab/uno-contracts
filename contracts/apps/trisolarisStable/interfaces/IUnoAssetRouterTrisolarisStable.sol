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

    function WETH() external view returns(address);
    function TrisolarisRouter() external view returns(address);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external returns (uint256 liquidity);
    function depositETH(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external payable returns(uint256 liquidity);
    function depositSingleAsset(address swap, address token, uint256 amount, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external returns(uint256 sent, uint256 liquidity);
    function depositSingleETH(address swap, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable returns(uint256 sentETH, uint256 liquidity);
    function depositLP(address swap, uint256 amount, address recipient) external;

    function withdraw(address swap, uint256 amount, uint256[] calldata minAmounts, address recipient) external returns (uint256[] memory amounts);
    function withdrawETH(address swap, uint256 amount, uint256[] calldata minAmounts, address recipient) external returns(uint256[] memory amounts);
    function withdrawSingleAsset(address swap, uint256 amount, address token, bytes[] calldata swapData, address recipient) external returns(uint256 amountToken, uint256[] memory amounts);
    function withdrawSingleETH(address swap, uint256 amount, bytes[] calldata swapData, address recipient) external returns(uint256 amountETH, uint256[] memory amounts);
    function withdrawLP(address swap, uint256 amount, address recipient) external;

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
