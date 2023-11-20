// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import './interfaces/IUnoAssetRouterQuickswapDual.sol'; 
import '../../interfaces/IUnoFarm.sol';
import "../../interfaces/IAggregationRouterV5.sol";
import '../../interfaces/IUniswapV2Router.sol';
import '../../interfaces/IUniswapV2Pair.sol';
import '../../interfaces/IStakingDualRewards.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterQuickswapDual is Initializable, PausableUpgradeable, UUPSUpgradeable, IUnoAssetRouterQuickswapDual {
    using SafeERC20 for IERC20;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpStakingPool}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    uint256 public fee;

    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
    IUniswapV2Router01 private constant QuickswapRouter = IUniswapV2Router01(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff); 
    address private constant OneInchRouter = 0x1111111254EEB25477B68fb85Ed929f73A960582;

    modifier onlyRole(bytes32 role){
        if(!accessManager.hasRole(role, msg.sender)) revert CALLER_NOT_AUTHORIZED();
        _;
    }

    // ============ Methods ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _accessManager, address _farmFactory) external initializer{
        if(_accessManager == address(0)) revert INVALID_ACCESS_MANAGER();
        if(_farmFactory == address(0)) revert INVALID_FARM_FACTORY();

        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);
    }

    receive() external payable {
        //Reject deposits from EOA
        if (msg.sender == tx.origin) revert ETH_DEPOSIT_REJECTED();
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpStakingPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpStakingPool - Address of the pool to deposit tokens in.
     * @param amountA  - Token A amount to deposit.
     * @param amountB -  Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentA - Token A amount sent to the farm.
     * @return sentB - Token B amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address lpStakingPool, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient) external whenNotPaused returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        if(amountA == 0 || amountB == 0) revert NO_TOKENS_SENT();
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpStakingPool));
        }

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        (sentA, sentB, liquidity) = _addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, address(farm));
        farm.deposit(liquidity, recipient);

        emit Deposit(lpStakingPool, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Autoconverts MATIC into WMATIC and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpStakingPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpStakingPool - Address of the pool to deposit tokens in.
     * @param amountToken  - Token amount to deposit.
     * @param amountTokenMin - Bounds the extent to which the TOKEN/WMATIC price can go up before the transaction reverts.
     * @param amountETHMin - Bounds the extent to which the WMATIC/TOKEN price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentToken - Token amount sent to the farm.
     * @return sentETH - WMATIC amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address lpStakingPool, uint256 amountToken, uint256 amountTokenMin, uint256 amountETHMin, address recipient) external payable whenNotPaused returns(uint256 sentToken, uint256 sentETH, uint256 liquidity){
        if(msg.value == 0 || amountToken == 0) revert NO_TOKENS_SENT();
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpStakingPool));
        }

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        if (tokenA == WMATIC) {
            IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountToken);
            (sentToken, sentETH, liquidity) = _addLiquidityETH(tokenB, amountToken, amountTokenMin, amountETHMin, address(farm));
        } else if (tokenB == WMATIC) {
            IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountToken);
            (sentToken, sentETH, liquidity) = _addLiquidityETH(tokenA, amountToken, amountTokenMin, amountETHMin, address(farm));
        } else revert NOT_ETH_FARM();

        farm.deposit(liquidity, recipient);

        emit Deposit(lpStakingPool, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits any tokens in the given pool by swapping them using 1inch. Creates new Farm contract if there isn't one deployed for the {lpPair}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpStakingPool - Address of the pool to deposit tokens in.
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent0 - Tokens sent to the farm from the {swapData[0]}.
     * @return sent1 - Tokens sent to the farm from the {swapData[1]}.
     * @return dustA - TokenA dust sent to the {msg.sender}.
     * @return dustB - TokenB dust sent to the {msg.sender}.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositWithSwap(address lpStakingPool, bytes[2] calldata swapData, address recipient) external payable whenNotPaused returns(uint256 sent0, uint256 sent1, uint256 dustA, uint256 dustB, uint256 liquidity){

        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpStakingPool));
        }

        _checkMsgValue(swapData);
        
        {
        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();

        uint256 amountA; uint256 amountAMin;
        uint256 amountB; uint256 amountBMin;
        (amountA, sent0, amountAMin) = _swapDeposit(swapData[0], IERC20(tokenA));
        (amountB, sent1, amountBMin) = _swapDeposit(swapData[1], IERC20(tokenB));

        // Variable naming is not correct, however I have to do it this way to avoid Stack too deep error.
        (amountAMin, amountBMin, liquidity) = _addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, address(farm));
        farm.deposit(liquidity, recipient);
        
        if(amountA > amountAMin){
            dustA = amountA - amountAMin;
        }
        if(amountB > amountBMin){
            dustB = amountB - amountBMin;
        }
        }

        emit Deposit(lpStakingPool, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpStakingPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpStakingPool - Address of the pool to deposit tokens in.
     * @param amount - LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     */
    function depositLP(address lpStakingPool, uint256 amount, address recipient) external whenNotPaused{
        if(amount == 0) revert NO_TOKENS_SENT();
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpStakingPool));
        }

        IERC20(farm.lpPool()).safeTransferFrom(msg.sender, address(farm), amount);
        farm.deposit(amount, recipient);

        emit Deposit(lpStakingPool, msg.sender, recipient, amount); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param lpStakingPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param amountAMin - The minimum amount of tokenA that must be received for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received for the transaction not to revert.
     * @param recipient - The address which will receive tokens.

     * @return amountA - Token A amount sent to the {recipient}.
     * @return amountB - Token B amount sent to the {recipient}.
     */ 
    function withdraw(address lpStakingPool, uint256 amount, uint256 amountAMin, uint256 amountBMin, address recipient) external returns(uint256 amountA, uint256 amountB){
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();
        
        farm.withdraw(amount, msg.sender, address(this));
        (amountA, amountB) = _removeLiquidity(farm.lpPool(), farm.tokenA(), farm.tokenB(), amount, amountAMin, amountBMin, recipient);

        emit Withdraw(lpStakingPool, msg.sender, recipient, amount);  
    }

    /** 
     * @dev Autoconverts WMATIC into MATIC and withdraws tokens from the pool. Emits a {Withdraw} event.
     * @param lpStakingPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param amountTokenMin - The minimum amount of token that must be received for the transaction not to revert.
     * @param amountETHMin - The minimum amount of MATIC that must be received for the transaction not to revert.
     * @param recipient - The address which will receive tokens.

     * @return amountToken - Token amount sent to the {recipient}.
     * @return amountETH - MATIC amount sent to the {recipient}.
     */ 
    function withdrawETH(address lpStakingPool, uint256 amount, uint256 amountTokenMin, uint256 amountETHMin, address recipient) external returns(uint256 amountToken, uint256 amountETH){
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        address lpPair = farm.lpPool();

        farm.withdraw(amount, msg.sender, address(this));
        if (tokenA == WMATIC) {
            (amountToken, amountETH) = _removeLiquidityETH(lpPair, tokenB, amount, amountTokenMin, amountETHMin, recipient);
        } else if (tokenB == WMATIC) {
            (amountToken, amountETH) = _removeLiquidityETH(lpPair, tokenA, amount, amountTokenMin, amountETHMin, recipient);
        } else revert NOT_ETH_FARM();

        emit Withdraw(lpStakingPool, msg.sender, recipient, amount);
    }

    /**
     * @dev Withdraws tokens from the given pool and swap them using 1inch. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token.
     * @param lpStakingPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - The address which will receive tokens.
     
     * @return amount0 - Tokens sent to the {recipient} from the {swapData[0]}.
     * @return amount1 - Tokens sent to the {recipient} from the {swapData[1]}.
     * @return amountA - TokenA dust sent to the {recipient}.
     * @return amountB - TokenB dust to the {recipient}.
     */
    function withdrawWithSwap(address lpStakingPool, uint256 amount, bytes[2] calldata swapData, address recipient) external returns(uint256 amount0, uint256 amount1, uint256 amountA, uint256 amountB){
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        farm.withdraw(amount, msg.sender, address(this));

        address tokenA = farm.tokenA();
        address tokenB = farm.tokenB();
        (uint256 _amountA, uint256 _amountB) = _removeLiquidity(farm.lpPool(), tokenA, tokenB, amount, 0, 0, address(this));
        
        (amount0, amountA) = _swapWithdraw(swapData[0], IERC20(tokenA), _amountA, recipient);
        (amount1, amountB) = _swapWithdraw(swapData[1], IERC20(tokenB), _amountB, recipient);

        emit Withdraw(lpStakingPool, msg.sender, recipient, amount);
    }

    /** 
     * @dev Withdraws LP tokens from the given pool. Emits a {Withdraw} event.
     * @param lpStakingPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param recipient - The address which will receive tokens.
     */ 
    function withdrawLP(address lpStakingPool, uint256 amount, address recipient) external {
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();
        
        farm.withdraw(amount, msg.sender, recipient);
        emit Withdraw(lpStakingPool, msg.sender, recipient, amount);  
    }

     /**
     * @dev Distributes tokens between users.
     * @param lpStakingPool - LP pool to distribute tokens in.
     * @param swapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenAToTokenA, rewardTokenAToTokenB, rewardTokenBToTokenA, rewardTokenBToTokenB) and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */ 
    function distribute(
        address lpStakingPool,
        Farm.SwapInfo[4] calldata swapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) returns(uint256 reward){
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        reward = farm.distribute(swapInfos, IUnoFarm.FeeInfo(feeTo, fee));
        emit Distribute(lpStakingPool, reward);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {lpStakingPool}.
     * @param _address - The address to check stakes for.
     * @param lpStakingPool - LP pool to check stakes in.

     * @return stakeLP - Total user stake(in LP tokens).
     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
    function userStake(address _address, address lpStakingPool) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB) {
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if (farm != Farm(address(0))) {
            stakeLP = farm.userBalance(_address);
            address lpPair = farm.lpPool();
            (stakeA, stakeB) = _getTokenStake(lpPair, stakeLP);
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpStakingPool - LP pool to check total deposits in.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */  
    function totalDeposits(address lpStakingPool) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB) {
        Farm farm = Farm(farmFactory.Farms(lpStakingPool));
        if (farm != Farm(address(0))) {
            totalDepositsLP = farm.getTotalDeposits();
            address lpPair = farm.lpPool();
            (totalDepositsA, totalDepositsB) = _getTokenStake(lpPair, totalDepositsLP);
        }
    }

    /**
     * @dev Returns addresses of pair of tokens in {lpStakingPool}.
     * @param lpStakingPool - LP pool to check tokens in.

     * @return tokens - Tokens addresses.
     */  
    function getTokens(address lpStakingPool) external view returns(IERC20[] memory tokens){
        tokens = new IERC20[](2);
        IUniswapV2Pair stakingToken = IUniswapV2Pair(address(IStakingDualRewards(lpStakingPool).stakingToken()));
        tokens[0] = IERC20(stakingToken.token0());
        tokens[1] = IERC20(stakingToken.token1());
    }

    /**
     * @dev Deposits assets to router & refunds dust.
     */ 
    function _addLiquidity(
        address tokenA,
        address tokenB, 
        uint256 amountA, 
        uint256 amountB, 
        uint256 amountAMin, 
        uint256 amountBMin, 
        address farm
    ) internal returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        IERC20(tokenA).approve(address(QuickswapRouter), amountA);
        IERC20(tokenB).approve(address(QuickswapRouter), amountB);

        (sentA, sentB, liquidity) = QuickswapRouter.addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, farm, block.timestamp);
        // Refund dust
        if(amountA > sentA){
            IERC20(tokenA).safeTransfer(msg.sender, amountA - sentA);
        }
        if(amountB > sentB){
		    IERC20(tokenB).safeTransfer(msg.sender, amountB - sentB);
        }
    }

    /**
     * @dev Deposits assets to router & refunds dust.
     */ 
    function _addLiquidityETH(
        address token,
        uint256 amount, 
        uint256 amountTokenMin, 
        uint256 amountETHMin, 
        address farm
    ) internal returns(uint256 sentToken, uint256 sentETH, uint256 liquidity){
        IERC20(token).approve(address(QuickswapRouter), amount);

        (sentToken, sentETH, liquidity) = QuickswapRouter.addLiquidityETH{value: msg.value}(token, amount, amountTokenMin, amountETHMin, farm, block.timestamp);
        // Refund dust
        if(amount > sentToken){
            IERC20(token).safeTransfer(msg.sender, amount - sentToken);
        }
        if(msg.value > sentETH){
            payable(msg.sender).transfer(msg.value - sentETH);
        }
    }

    /**
     * @dev Withdraws assets from router.
     */ 
    function _removeLiquidity(
        address lpPair,
        address tokenA,
        address tokenB, 
        uint256 amount, 
        uint256 amountAMin, 
        uint256 amountBMin, 
        address recipient
    ) internal returns(uint256 amountA, uint256 amountB){
        IERC20(lpPair).approve(address(QuickswapRouter), amount);
        (amountA, amountB) = QuickswapRouter.removeLiquidity(tokenA, tokenB, amount, amountAMin, amountBMin, recipient, block.timestamp);
    }

    /**
     * @dev Withdraws assets from router.
     */ 
    function _removeLiquidityETH(
        address lpPair,
        address token,
        uint256 amount, 
        uint256 amountTokenMin, 
        uint256 amountETHMin, 
        address recipient
    ) internal returns(uint256 amountToken, uint256 amountETH){
        IERC20(lpPair).approve(address(QuickswapRouter), amount);
        (amountToken, amountETH) = QuickswapRouter.removeLiquidityETH(token, amount, amountTokenMin, amountETHMin, recipient, block.timestamp);
    }

    function _swapDeposit(bytes calldata swapData, IERC20 toToken) internal returns(uint256 returnAmount, uint256 spentAmount, uint256 amountMin){
        (,IAggregationRouterV5.SwapDescription memory desc,) = abi.decode(swapData[4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        
        amountMin = desc.minReturnAmount;
        if(desc.srcToken == toToken){
            if(desc.amount == 0) revert INVALID_SWAP_DESCRIPTION();
            desc.srcToken.safeTransferFrom(msg.sender, address(this), desc.amount);
            return (desc.amount, desc.amount, amountMin);
        }
        
        if(
            bytes4(swapData[:4]) != IAggregationRouterV5.swap.selector || 
            desc.dstToken != toToken || 
            desc.amount == 0 ||
            desc.dstReceiver != address(this)
        ) revert INVALID_SWAP_DESCRIPTION();

        bool isETH = (address(desc.srcToken) == address(0) || address(desc.srcToken) == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE));
        if(!isETH){
            desc.srcToken.safeTransferFrom(msg.sender, address(this), desc.amount);
            desc.srcToken.approve(OneInchRouter, desc.amount);
        }

        {
        uint256 value = isETH ? desc.amount : 0;
        (bool success, bytes memory data) = OneInchRouter.call{value: value}(swapData);
        if(!success) revert SWAP_NOT_SUCCESSFUL();
        (returnAmount, spentAmount) = abi.decode(data, (uint256, uint256));
        }

        if(desc.amount > spentAmount){
            if(isETH){
                (bool success, ) = msg.sender.call{value: desc.amount - spentAmount}("");
                if(!success) revert TRANSFER_NOT_SUCCESSFUL();
            }else{
                desc.srcToken.safeTransfer(address(msg.sender), desc.amount - spentAmount);
            }
        }
    }
 
    function _swapWithdraw(bytes calldata swapData, IERC20 fromToken, uint256 maxAmount, address recipient) internal returns(uint256 returnAmount, uint256 dust){
        (,IAggregationRouterV5.SwapDescription memory desc,) = abi.decode(swapData[4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        
        if(desc.dstToken == fromToken){
            fromToken.safeTransfer(recipient, maxAmount);
            return (maxAmount, 0);
        }
        
        if(
            bytes4(swapData[:4]) != IAggregationRouterV5.swap.selector || 
            desc.srcToken != fromToken ||
            desc.amount == 0 ||
            desc.dstReceiver != recipient
        ) revert INVALID_SWAP_DESCRIPTION();

        desc.srcToken.approve(OneInchRouter, desc.amount);
        (bool success, bytes memory data) = OneInchRouter.call(swapData);
        if(!success) revert SWAP_NOT_SUCCESSFUL();
        uint256 spentAmount;
        (returnAmount, spentAmount) = abi.decode(data, (uint256, uint256));

        if(maxAmount > spentAmount){
            dust = maxAmount - spentAmount;
            desc.srcToken.safeTransfer(recipient, dust);
        } else if(maxAmount != spentAmount) revert INSUFFICIENT_AMOUNT();
    }

    function _checkMsgValue(bytes[2] calldata swapData) internal view {
        uint256 value;

        (,IAggregationRouterV5.SwapDescription memory desc0,) = abi.decode(swapData[0][4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        if(address(desc0.srcToken) == address(0) || address(desc0.srcToken) == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)){
            value = desc0.amount;
        }

        (,IAggregationRouterV5.SwapDescription memory desc1,) = abi.decode(swapData[1][4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        if(address(desc1.srcToken) == address(0) || address(desc1.srcToken) == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)){
            value += desc1.amount;
        }

        if(msg.value != value) revert INVALID_MSG_VALUE();
    }

    /**
     * @dev Converts LP tokens to normal tokens, value(amountA) == value(amountB) == 0.5*amountLP
     * @param lpPair - LP pair for conversion.
     * @param amountLP - Amount of LP tokens to convert.

     * @return amountA - Token A amount.
     * @return amountB - Token B amount.
     */ 
    function _getTokenStake(address lpPair, uint256 amountLP) internal view returns (uint256 amountA, uint256 amountB) {
        uint256 totalSupply = IERC20(lpPair).totalSupply();
        amountA = amountLP * IERC20(IUniswapV2Pair(lpPair).token0()).balanceOf(lpPair) / totalSupply;
        amountB = amountLP * IERC20(IUniswapV2Pair(lpPair).token1()).balanceOf(lpPair) / totalSupply;
    }

    /**
     * @dev Change fee amount.
     * @param _fee -New fee to collect from farms. [10^18 == 100%]
     *
     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function setFee(uint256 _fee) external onlyRole(accessManager.ADMIN_ROLE()){
        if(_fee > 1 ether) revert MAX_FEE_EXCEEDED(1 ether);
        if(fee != _fee){
            emit FeeChanged(fee, _fee); 
            fee = _fee;
        }
    }
 
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(accessManager.ADMIN_ROLE()) {

    }
}
