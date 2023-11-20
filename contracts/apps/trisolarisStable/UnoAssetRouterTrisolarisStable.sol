// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import '../../interfaces/IUnoFarm.sol';
import "../../interfaces/IAggregationRouterV5.sol";
import './interfaces/IUnoAssetRouterTrisolarisStable.sol'; 
import "../../interfaces/IUnoFarmFactory.sol";
import "../../interfaces/IUnoAccessManager.sol";
import "../../interfaces/ISwap.sol";
import '../../interfaces/IWETH.sol';
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract UnoAssetRouterTrisolarisStable is Initializable, PausableUpgradeable, UUPSUpgradeable, IUnoAssetRouterTrisolarisStable {
    using SafeERC20 for IERC20;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {swap}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private ADMIN_ROLE;
    bytes32 private constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public fee;

    address public constant WETH = 0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB;
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

    function initialize(address _accessManager, address _farmFactory) external initializer {
        if(_accessManager == address(0)) revert INVALID_ACCESS_MANAGER();
        if(_farmFactory == address(0)) revert INVALID_FARM_FACTORY();

        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);

        ADMIN_ROLE = accessManager.ADMIN_ROLE();
    }

    receive() external payable {
        if (msg.sender == tx.origin) revert ETH_DEPOSIT_REJECTED();
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {swap} and deposits tokens in it. Emits a {Deposit} event.
     * @param swap - Address of the Swap contract.
     * @param amounts - Amounts of tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {amounts} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external whenNotPaused returns (uint256 liquidity) {
        IERC20[] memory tokens = getTokens(swap);
        if (amounts.length != tokens.length) revert INVALID_AMOUNT_LENGTH(tokens.length);
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm == Farm(address(0))) {
            farm = Farm(farmFactory.createFarm(swap));
        }

        for (uint256 i = 0; i < amounts.length; i++) { 
            if (amounts[i] > 0) {
                IERC20(farm.tokens(i)).safeTransferFrom(msg.sender, address(this), amounts[i]); 
            }
        }
 
        liquidity = _addLiquidity(swap, amounts, tokens, minAmountLP, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(swap, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Autoconverts ETH into WETH and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {swap} and deposits tokens in it.
     * @param swap - Address of the Swap contract.
     * @param amounts - Amounts of tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {amounts} deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address swap, uint256[] memory amounts, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256 liquidity){
        if(msg.value == 0) revert INVALID_MSG_VALUE();
        IERC20[] memory tokens = getTokens(swap);
        if (amounts.length != tokens.length) revert INVALID_AMOUNT_LENGTH(tokens.length);

        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm == Farm(address(0))) {
            farm = Farm(farmFactory.createFarm(swap));
        }

        bool WETHInTokens;
        IWETH(WETH).deposit{value: msg.value}();
        for (uint256 i = 0; i < amounts.length; i++) {
            address token = farm.tokens(i);
            if(token == WETH){
                amounts[i] = msg.value;
                WETHInTokens = true;
                continue;
            }
            if(amounts[i] > 0){
                IERC20(token).safeTransferFrom(msg.sender, address(this), amounts[i]);
            }
        }
        if(!WETHInTokens) revert NOT_ETH_FARM();
        
        liquidity = _addLiquidity(swap, amounts, tokens, minAmountLP, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(swap, msg.sender, recipient, liquidity); 
    }

    /**
     * @dev Deposits tokens in the given pool with swap. Creates new Farm contract if there isn't one deployed for the {swap}, swaps {token} for pool tokens and deposits them. Emits a {Deposit} event.
     * @param swap - Address of the pool to deposit tokens in.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param minAmountLP - Minimum LP the user will receive from {tokens} deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent - Total amount amount sent to the farm. 
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositWithSwap(address swap, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable whenNotPaused returns(uint256[] memory sent, uint256 liquidity){
        IERC20[] memory tokens = getTokens(swap);
        if (swapData.length != tokens.length) revert INVALID_SWAP_DATA_LENGTH(tokens.length);
        
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(swap));
        }

        _checkMsgValue(swapData);

        sent = new uint256[](tokens.length);
        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; i++) {
            (uint256 _amount, uint256 _sent) = _swapDeposit(swapData[i], IERC20(tokens[i]));
            amounts[i] = _amount;
            sent[i] = _sent;
        }

        liquidity = _addLiquidity(swap, amounts, tokens, minAmountLP, farm);
        farm.deposit(liquidity, recipient);

        emit Deposit(swap, msg.sender, recipient, liquidity);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it. Emits a {Deposit} event.
     * @param swap - Address of the pool to deposit tokens in.
     * @param amount - LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     */
    function depositLP(address swap, uint256 amount, address recipient) external whenNotPaused{
        if(amount == 0) revert NO_TOKENS_SENT();
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(swap));
        }

        IERC20(farm.lpPool()).safeTransferFrom(msg.sender, address(farm), amount);
        farm.deposit(amount, recipient);

        emit Deposit(swap, msg.sender, recipient, amount); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param swap - Address of the Swap contract.
     * @param amount - Amounts of LP tokens to withdraw.
     * @param minAmounts - Minimum amounts of tokens sent to {recipient}.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to {recipient}, an array of zeros if withdrawLP == false.
     */
    function withdraw(
        address swap,
        uint256 amount,
        uint256[] calldata minAmounts,
        address recipient
    ) external returns (uint256[] memory amounts) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        farm.withdraw(amount, msg.sender, address(this));
        amounts = _removeLiquidity(swap, amount, _convertToAddressArray(getTokens(swap)), minAmounts, recipient, farm);

        emit Withdraw(swap, msg.sender, recipient, amount);
    }

        /** 
     * @dev Autoconverts WETH into ETH and withdraws tokens from the given pool. 
     * @param swap - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param minAmounts - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}
     */ 
    function withdrawETH(address swap, uint256 amount, uint256[] calldata minAmounts, address recipient) external returns(uint256[] memory amounts){ 
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        address[] memory tokens = _convertToAddressArray(getTokens(swap));
        farm.withdraw(amount, msg.sender, address(this));
        amounts = _removeLiquidity(swap, amount, tokens, minAmounts, address(this), farm);

        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] != WETH) {
                IERC20(tokens[i]).safeTransfer(recipient, amounts[i]);
                continue;
            }
            IWETH(WETH).withdraw(amounts[i]);
            payable(recipient).transfer(amounts[i]);
        } 
        emit Withdraw(swap, msg.sender, recipient, amount);  
    }

    /**
     * @dev Withdraws single token from the given pool. Emits a {Withdraw} event. Note: If there are any tokens left to be withdrawn after swaps they will be sent to the {{recipient}} in a respective token (not in {token}).
     * @param swap - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param swapData - Parameters with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return amounts - Amounts sent to the {recipient} from swapData.
     * @return dust - Dust amounts sent to the {recipient} left from swaps.
     */
    function withdrawWithSwap(address swap, uint256 amount, bytes[] calldata swapData, address recipient) external returns(uint256[] memory amounts, uint256[] memory dust){
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        address[] memory tokens = _convertToAddressArray(getTokens(swap));
        if (swapData.length != tokens.length) revert INVALID_SWAP_DATA_LENGTH(tokens.length);

        dust = new uint256[](tokens.length);
        amounts = new uint256[](tokens.length);

        farm.withdraw(amount, msg.sender, address(this));
        amounts = _removeLiquidity(swap, amount, tokens, amounts, address(this), farm);
        for (uint256 i = 0; i < tokens.length; i++) {
            (uint256 _amount, uint256 _dust) = _swapWithdraw(swapData[i], IERC20(tokens[i]), amounts[i], recipient);
            amounts[i] = _amount;
            dust[i] = _dust;
        }

        emit Withdraw(swap, msg.sender, recipient, amount);
    }

    /** 
     * @dev Withdraws LP tokens from the given pool. Emits a {Withdraw} event.
     * @param swap - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param recipient - The address which will receive tokens.
     */ 
    function withdrawLP(address swap, uint256 amount, address recipient) external {
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();
        
        farm.withdraw(amount, msg.sender, recipient);
        emit Withdraw(swap, msg.sender, recipient, amount);  
    }

    /**
     * @dev Distributes tokens between users.
     * @param swap - Address of the Swap contract.

     * @param rewardSwapInfos - Arrays of structs with token arrays describing swap routes from reward to tokens in {swap} and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param rewarderSwapInfos - Arrays of structs with token arrays describing swap routes from rewarder to tokens in {swap} and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address swap,
        Farm.SwapInfo[] calldata rewardSwapInfos,
        Farm.SwapInfo[] calldata rewarderSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) returns(uint256 reward){
        Farm farm = Farm(farmFactory.Farms(swap));
        if(farm == Farm(address(0))) revert FARM_NOT_EXISTS();

        //I don't understand why the definition for FeeInfo can not be imported from Farm
        reward = farm.distribute(
            rewardSwapInfos,
            rewarderSwapInfos,
            IUnoFarm.FeeInfo(feeTo, fee)
        );
        emit Distribute(swap, reward);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {swap}.
     * @param _address - The address to check stakes for.
     * @param swap - Address of the Swap contract.

     * @return stakeLP - Total user stake(in LP tokens).
     */
    function userStake(address _address, address swap) external view returns (uint256 stakeLP) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm != Farm(address(0))) {
            stakeLP = farm.userBalance(_address);
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param swap - Address of the Swap contract.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     */
    function totalDeposits(address swap) external view returns (uint256 totalDepositsLP) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm != Farm(address(0))) {
            totalDepositsLP = farm.getTotalDeposits();
        }
    }

    /**
     * @dev Deposits assets to router
     */ 
    function _addLiquidity(
        address swap,
        uint256[] memory amounts, 
        IERC20[] memory tokens,
        uint256 minAmountLP,
        Farm farm
    ) internal returns(uint256 liquidity){
        bool joinPool;
        for (uint256 i = 0; i < amounts.length; i++) {
            if(amounts[i] > 0){
                if(!joinPool){
                    joinPool = true;
                }
                tokens[i].approve(swap, amounts[i]);
            }
        }
        if(!joinPool) revert NO_LIQUIDITY_PROVIDED();
        liquidity = ISwap(swap).addLiquidity(amounts, minAmountLP, block.timestamp);
        IERC20(farm.lpPool()).safeTransfer(address(farm), liquidity);
    }

    /**
     * @dev Withdraws assets from router.
     */ 
    function _removeLiquidity(
        address swap,
        uint256 amount, 
        address[] memory tokens,
        uint256[] memory minAmounts,
        address recipient,
        Farm farm
    ) internal returns(uint256[] memory amounts){
        if(minAmounts.length != tokens.length) revert INVALID_MIN_AMOUNTS_LENGTH(tokens.length);

        IERC20(farm.lpPool()).approve(swap, amount);
        amounts = ISwap(swap).removeLiquidity(amount, minAmounts, block.timestamp);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).safeTransfer(recipient, amounts[i]);
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
        for (uint256 i = 0; i < tokenArray.length; i++) {
            addresses[i] = address(tokenArray[i]);
        }
    }

    /**
     * @dev Returns addresses of tokens in {swap}.
     * @param swap - Swap to check tokens in.

     * @return tokens - Array of token addresses.
     */  
    function getTokens(address swap) public view returns(IERC20[] memory tokens){
        uint8 tokenCount;
        address[] memory _tokens = new address[](type(uint8).max);
        for (uint8 i = 0; i < type(uint8).max; i++) {
            try ISwap(swap).getToken(i) returns (address token) {
                _tokens[i] = token;
                tokenCount++;
            } catch (bytes memory /*lowLevelData*/) {
                break;
            }
        }
        if(tokenCount == 0) revert NO_TOKENS_IN_SWAP();

        tokens = new IERC20[](tokenCount);
        for (uint8 i = 0; i < tokenCount; i++) {
            tokens[i] = IERC20(_tokens[i]);
        }
        return tokens;
    }

    /**
     * @dev Change fee amount.
     * @param _fee -New fee to collect from farms. [10^18 == 100%]
     *
     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function setFee(uint256 _fee) external onlyRole(ADMIN_ROLE){
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

    function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {}
}
