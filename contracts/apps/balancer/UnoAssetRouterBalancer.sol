// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../interfaces/IUnoFarm.sol';
import './interfaces/IUnoAssetRouterBalancer.sol'; 
import "../../interfaces/IBasePool.sol";
import '../../interfaces/IWMATIC.sol';
import "../../interfaces/IAggregationRouterV5.sol";
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterBalancer is Initializable, PausableUpgradeable, UUPSUpgradeable, IUnoAssetRouterBalancer {
    using SafeERC20 for IERC20;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpPool}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    uint256 public fee;

    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
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
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external whenNotPaused returns(uint256 liquidity){
        if (amounts.length != tokens.length) revert INPUT_PARAMS_LENGTHS_NOT_MATCH();
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        bytes32 poolId = farm.poolId();
        _checkTokens(tokens, poolId);

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                if(tokens[i] == lpPool){
                    amounts[i] == 0;
                    continue;
                }
                IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
            }
        }

        liquidity = _addLiquidity(amounts, tokens, minAmountLP, lpPool, poolId, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Autoconverts MATIC into WMATIC and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256 liquidity){
        if(msg.value == 0) revert INVALID_MSG_VALUE();
        if (amounts.length != tokens.length) revert INPUT_PARAMS_LENGTHS_NOT_MATCH();
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        bytes32 poolId = farm.poolId();
        _checkTokens(tokens, poolId);

        bool WMATICInTokens;
        IWMATIC(WMATIC).deposit{value: msg.value}();
        for (uint256 i = 0; i < tokens.length; i++) {
            if(tokens[i] == lpPool){
                amounts[i] == 0;
                continue;
            }
            if(tokens[i] == WMATIC){
                amounts[i] = msg.value;
                WMATICInTokens = true;
                continue;
            }
            if(amounts[i] > 0){
                IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
            }
        }
        if(!WMATICInTokens) revert NOT_ETH_FARM();

        liquidity = _addLiquidity(amounts, tokens, minAmountLP, lpPool, poolId, farm);
        farm.deposit(liquidity, recipient);
        
        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Deposits tokens in the given pool with swap. Creates new Farm contract if there isn't one deployed for the {lpPool}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent - Total amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositWithSwap(address lpPool, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256[] memory sent, uint256 liquidity){
        address[] memory tokens = _convertToAddressArray(getTokens(lpPool));
        if (swapData.length != tokens.length) revert INPUT_PARAMS_LENGTHS_NOT_MATCH();

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        _checkMsgValue(swapData);

        sent = new uint256[](tokens.length);
        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            if (tokens[i] == lpPool) {
                continue;
            }
            (uint256 _amount, uint256 _sent) = _swapDeposit(swapData[i], IERC20(tokens[i]));
            amounts[i] = _amount;
            sent[i] = _sent;
        }

        liquidity = _addLiquidity(amounts, tokens, minAmountLP, lpPool, farm.poolId(), farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(lpPool, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amount - LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     */
    function depositLP(address lpPool, uint256 amount, address recipient) external whenNotPaused{
        if(amount == 0) revert NO_TOKENS_SENT();
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        IERC20(lpPool).safeTransferFrom(msg.sender, address(farm), amount);
        farm.deposit(amount, recipient);

        emit Deposit(lpPool, msg.sender, recipient, amount); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param userData - Balancer pool exit userData.
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */ 
    function withdraw(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        (amounts, liquidity) = farm.withdrawTokens(userData, minAmountsOut, msg.sender, recipient);
        emit Withdraw(lpPool, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Autoconverts WMATIC into MATIC and withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param userData -  Balancer pool exit userData.
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */ 
    function withdrawETH(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        (amounts, liquidity) = farm.withdrawTokens(userData, minAmountsOut, msg.sender, address(this));

        IERC20[] memory tokens = getTokens(lpPool);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (amounts[i] == 0){
                continue;
            }
            if (address(tokens[i]) != WMATIC) {
                IERC20(address(tokens[i])).safeTransfer(recipient, amounts[i]);
                continue;
            }
            IWMATIC(WMATIC).withdraw(amounts[i]);
            payable(recipient).transfer(amounts[i]);
        }

        emit Withdraw(lpPool, msg.sender, recipient, liquidity);  
    }

    /**
     * @dev Withdraws single token from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in {token}).
     * @param lpPool - LP pool to withdraw from.
     * @param userData - Balancer pool exit userData.
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amounts - Amounts sent to the {recipient} from swapData.
     * @return dust - Dust amounts sent to the {recipient} left from swaps.
     * @return liquidity - Total liquidity sent to the user (in lpTokens).
     */
    function withdrawWithSwap(address lpPool, bytes calldata userData, bytes[] calldata swapData, address recipient) external returns(uint256[] memory amounts, uint256[] memory dust, uint256 liquidity){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        address[] memory tokens = _convertToAddressArray(getTokens(lpPool));
        if (swapData.length != tokens.length) revert INPUT_PARAMS_LENGTHS_NOT_MATCH();

        dust = new uint256[](tokens.length);
        amounts = new uint256[](tokens.length);
        (amounts, liquidity) = farm.withdrawTokens(userData, amounts, msg.sender, address(this));
        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] == 0){
                continue;
            }

            (uint256 _amount, uint256 _dust) = _swapWithdraw(swapData[i], IERC20(tokens[i]), amounts[i], recipient);
            amounts[i] = _amount;
            dust[i] = _dust;
        }

        emit Withdraw(lpPool, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Withdraws LP tokens from the given pool. Emits a {Withdraw} event.
     * @param lpPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param recipient - The address which will receive tokens.
     */ 
    function withdrawLP(address lpPool, uint256 amount, address recipient) external {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();
        
        farm.withdraw(amount, msg.sender, recipient);
        emit Withdraw(lpPool, msg.sender, recipient, amount);  
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpPool]}.
     * @param lpPool - The pool to distribute. 
     * @param swapInfos - The data used to swap reward tokens for the needed tokens.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPool,
        Farm.SwapInfo[] calldata swapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) returns(uint256 reward){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        reward = farm.distribute(swapInfos, IUnoFarm.FeeInfo(feeTo, fee));
        emit Distribute(lpPool, reward);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPool}.
     * @param _address - The address to check stakes for.
     * @param lpPool - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
   function userStake(address _address, address lpPool) external view returns(uint256){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.userBalance(_address);
        }
        return 0;
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPool - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */
    function totalDeposits(address lpPool) external view returns (uint256) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.getTotalDeposits();
        }
        return 0;
    }

    /**
     * @dev Returns addresses of tokens in {lpPool}.
     * @param lpPool - LP pool to check tokens in.

     * @return tokens - Token addresses.
     */  
    function getTokens(address lpPool) public view returns(IERC20[] memory tokens){
        bytes32 poolId = IBasePool(lpPool).getPoolId();
        (tokens, , ) = Vault.getPoolTokens(poolId);
    }

    /**
     * @dev Deposits assets to router
     */ 
    function _addLiquidity(
        uint256[] memory amounts, 
        address[] memory tokens,
        uint256 minAmountLP,
        address lpPool,
        bytes32 poolId,
        Farm farm
    ) internal returns(uint256 liquidity){
        bool joinPool;
        for (uint256 i = 0; i < amounts.length; i++) {
            if(amounts[i] > 0){
                if(!joinPool){
                    joinPool = true;
                }
                IERC20(tokens[i]).approve(address(Vault), amounts[i]);
            }
        }
        if(!joinPool) revert NO_LIQUIDITY_PROVIDED();

        bytes memory userData;
        if(farm.isComposable()){
            //If pool has pre-minted BPT then don't include those in userData.
            uint256[] memory _amounts = new uint256[](amounts.length - 1);
            uint256 _i = 0;
            for (uint256 i = 0; i < tokens.length; i++) {
                if(tokens[i] != lpPool){
                    _amounts[_i] = amounts[i];
                    _i += 1;
                }
            }
            userData = abi.encode(1, _amounts, minAmountLP);
        } else {
            userData = abi.encode(1, amounts, minAmountLP);
        }

        uint256 amountBefore = IERC20(lpPool).balanceOf(address(farm));
        IVault.JoinPoolRequest memory joinPoolRequest = IVault.JoinPoolRequest(tokens, amounts, userData, false);
        Vault.joinPool(poolId, address(this), address(farm), joinPoolRequest);

        liquidity = IERC20(lpPool).balanceOf(address(farm)) - amountBefore;
    }

    /**
     * @dev Compares passed calldata tokens with real pool tokens
     */ 
    function _checkTokens(
        address[] calldata tokens,
        bytes32 poolId
    ) internal view {
        (IERC20[] memory _tokens,,) = Vault.getPoolTokens(poolId);
        if(tokens.length != _tokens.length) revert INVALID_TOKENS_LENGTH(_tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            if(tokens[i] != address(_tokens[i])) revert TOKENS_NOT_MATCH_POOL_TOKENS(i);
        }
    }

    function _swapDeposit(bytes calldata swapData, IERC20 toToken) internal returns(uint256 returnAmount, uint256 spentAmount){
        (,IAggregationRouterV5.SwapDescription memory desc,) = abi.decode(swapData[4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        
        if(desc.srcToken == toToken){
            if(desc.amount == 0) revert INVALID_SWAP_DESCRIPTION();
            desc.srcToken.safeTransferFrom(msg.sender, address(this), desc.amount);
            return (desc.amount, desc.amount);
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

    function _checkMsgValue(bytes[] calldata swapData) internal view {
        uint256 value;
        for(uint256 i; i < swapData.length; i++){
            (,IAggregationRouterV5.SwapDescription memory desc,) = abi.decode(swapData[i][4:], (address, IAggregationRouterV5.SwapDescription, bytes));
            if(address(desc.srcToken) == address(0) || address(desc.srcToken) == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE)){
                value += desc.amount;
            }
        }

        if(msg.value != value) revert INVALID_MSG_VALUE();
    }

    function _convertToAddressArray(IERC20[] memory tokenArray) internal pure returns (address[] memory addresses) {
        addresses = new address[](tokenArray.length);
        for (uint256 i; i < tokenArray.length; i++) {
            addresses[i] = address(tokenArray[i]);
        }
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
