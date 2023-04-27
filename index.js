// Requires: node-opcua, winston
const opcua = require("node-opcua");
const fs = require("fs");
const { createLogger, format, transports } = require("winston");
const { printf, combine, timestamp, label, prettyPrint } = format;
const logLevels = {  fatal: 0,  error: 1,  warn: 2,  info: 3,  debug: 4,  trace: 5, };
const loggerFormat = printf(({ level, message, label, timestamp }) => {
	return `${timestamp} [${label}] ${level}: ${message}`;
});

// Create logger
const logger = createLogger({
  levels: logLevels,
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'wago.log' })
  ],
  format: combine(
    label({ label: 'WAGO' }),
    timestamp(),
    loggerFormat
  ),
});

// Class WagoPLC
//
// This class is used to control the Wago PLC with OPC UA protocol
// It is used to read and write data from the PLC
// It is also used to subscribe to data changes
//
// It is based on the node-opcua library
//
// Each method returns get logs in the console
//
class WagoPLC{
	// Wago variables
	ip = null;									// IP address of the PLC
	wLogin = null;								// Login of the PLC
	password = null;							// Password of the PLC
	session = null;								// Session with the PLC
	subscription = null;						// Subscription to the PLC
	itemsToMonitor = [];						// Array of items to monitor
	itemsAvailable = [];						// Array of items browsed from the PLC
	client = null;								// OPCUA client
	SocketIO = null;							// Socket to send data to the frontends

	// Static variables
	cacheDirectory = "./cache";					// Cache directory for the OPCUA client
	cacheFile = "items.json";					// File to store the items browsed from the PLC

	// Others variables
	debug = false;						// Log events
	currentBrowsing = false;			// True if a browsing is in progress
	
	// Constructor with the IP address of the PLC, login and password
	constructor(ip, login, password){
        logger.info("=== WagoPLC constructor on : " + ip + " ===");
	
		// Check if cache directory exists
		if (!fs.existsSync(this.cacheDirectory)){
			fs.mkdirSync(this.cacheDirectory);
		}

		// Delete cache file if exist
		this.#deleteCacheFile();

		this.ip = ip;
		this.wLogin = login;
		this.password = password;

		// Create OPCUA client
		this.client = opcua.OPCUAClient.create({
			connectionStrategy:{ initialDelay: 1000, maxRetry: 1},
			endpointMustExist: true
		});

		// Log events
		this.client.on("connected", function(){	                    	logger.info("|_ Connected to OPCUA Server !")} );
		this.client.on("connection_failed", function(){	    			logger.error("|_ Connection failed !")} );
		this.client.on("connection_lost", function(){	            	logger.error("  |_ Connection lost !")} );
		this.client.on("close", function(){	                        	logger.info("  |_ Close !")} );
		this.client.on("start_reconnection", function(){	        	logger.info("  |_ Start reconnection !")} );
		this.client.on("after_reconnection", function(){	        	logger.info("  |_ Reconnection OK !")} );
		this.client.on("backoff", function(){	                    	logger.debug("  |_ Backoff !")} );
		this.client.on("reconnection_attempt_has_failed", function(){	logger.debug("  |_ Reconnection attempt has failed !")} );
		this.client.on("abort", function(){	                        	logger.debug("  |_ Abort !")} );
		this.client.on("send_chunk", function(){	                	logger.debug("  |_ Send chunk !")} );
		this.client.on("receive_chunk", function(){	                	logger.debug("  |_ Receive chunk !")} );
		this.client.on("send_request", function(){	                	logger.debug("  |_ Send request !")} );
		this.client.on("receive_response", function(){	            	logger.debug("  |_ Receive response !")} );
		this.client.on("lifetime_75", function(){	                	logger.debug("  |_ Lifetime 75 !")} );
		this.client.on("security_token_renewed", function(){	    	logger.debug("  |_ Security token renewed !")} );
		this.client.on("connection_reestablished", function(){	    	logger.debug("  |_ Connection reestablished !")} );
		this.client.on("timed_out_request", function(){	            	logger.debug("  |_ Timed out request !")} );
		logger.info("  |_ WagoPLC constructor done !");
	}

	setLogLevel(level){
		logger.level = level;
	}

	setCacheDirectory(directory){
		this.cacheDirectory = directory;
	}

	setCacheFile(file){
		this.cacheFile = file;
	}

	ping(){
		const ping = this.session !== null && this.session.sessionId !== null;
		logger.debug("  |_ Ping : " + ping);
		return ping;
	}

	setSocketIO(io){
		this.SocketIO = io;
	}

	// Connect to the PLC with ip, create the session with login and password
	async connect(){
		// Connect to the PLC
		await this.client.connect(this.ip);

		logger.info("  |_ Creating session.. !");

		// Create the session
		this.session = await this.client.createSession({userName: this.wLogin, password: this.password});
		logger.info("    |_ Session created !");

		// Log events : keepalive, keepalive_failure, session_closed, session_restored
		this.session.on("keepalive", function(){	                    logger.debug("    |_ Keepalive !")} );
		this.session.on("keepalive_failure", function(){	    		logger.error("    |_ Keepalive failure !")} );
		this.session.on("session_closed", function(){	            	logger.error("    |_ Session closed !")} );
		this.session.on("session_restored", function(){	            	logger.info("    |_ Session restored !")} );
	}

	// Disconnect from the PLC
	async disconnect(){
		// Disconnect from the PLC
		await this.client.disconnect();
	}

	// Close session and subscription
	async close(){
		// Close the session if it exists
		if(this.session != null)		await this.session.close();

		// Close the subscription if it exists
		if(this.subscription != null)	await this.subscription.terminate();
	}

	#logItem(who){
		// Get Item from the monitored list
		const item = this.FindMonitoredItem(who);
		if(item === false) 		return;

		console.log(item);
	}

	// Read data from the PLC. Return the value of the data
	async readData(nodeId){
		// Read the data
		const dataValue = await this.session.read({
			nodeId: nodeId,
			attributeId: opcua.AttributeIds.Value
		});

		// Log the value
		logger.info("    |_ Read data : " + nodeId);

		return dataValue.value;
	}

	// Read data from the PLC. Return the value of the data
	async readDataType(nodeId){
		// Read the data
		const dataValue = await this.session.read({
			nodeId: nodeId,
			attributeId:opcua.AttributeIds.DataType
		});

		// Log the value
		logger.info("    |_ Read type : " + nodeId);

		return dataValue.value;
	}

	FindAvailableItem(who){
		who = who.toString();
		const item = this.itemsAvailable.find(item => item.node.nodeId == who);

		return item;
	}

	FindAvailableItemIndex(who){
		who = who.toString();
		const index = this.itemsAvailable.findIndex(item => item.node.nodeId == who);

		return index;
	}

	FindMonitoredItem(who){
		// Search item on monitor list. If not monitored, we should be allowed to modify it.
		who = who.toString();
		const item = this.itemsToMonitor.find(item => item.nodeId == who);

		return item;
	}

	async switchBoolValue(who){
		// Get Item from the monitored list
		const item = this.FindMonitoredItem(who);
		if(item === false) 		return;

		return this.writeData(who, !item.value);
	}

	// Write data to the PLC. Return the status code
	async writeData(who, what){
		// Get Item from the monitored list
		const item = this.FindMonitoredItem(who);
		if(item === false) 		return;

		var WriteValue = null;
		var WriteDataType = null;

		logger.info("    |_ Write data : " + who + " : " + what);

		switch (typeof item.value) {
			case "boolean":
				WriteValue 		= what;
				WriteDataType 	= opcua.DataType.Boolean;
				break;

			case "object":
				// Construct new value by merging the structure of the old value with the new value
				WriteValue 		= Object.assign(item.value, what);
				// Construct the ExtensionObject
				WriteValue 		= await this.session.constructExtensionObject(item.dataType, WriteValue);
				WriteDataType 	= opcua.DataType.ExtensionObject
				break;

			case "number":
				if( item.dataType.value == 10 ){
					WriteValue		= Number.parseFloat(what);
					WriteDataType 	= opcua.DataType.Float;
				}else if( item.dataType.value == 4 ){
					WriteValue		= Number.parseInt(what);
					WriteDataType 	= opcua.DataType.Int16;
				}else if( item.dataType.value == 6 ){
					WriteValue		= Number.parseInt(what);
					WriteDataType 	= opcua.DataType.Int32;
				}else if( item.dataType.value == 8 ){
					WriteValue		= Number.parseInt(what);
					WriteDataType 	= opcua.DataType.Int64;
				}
				break;

			default:
				logger.error("    |_ Unknown data type : " + typeof item.value);
				return false;
		}

		logger.info("      |_ Value : " + JSON.stringify(WriteValue) );

		// Write to the PLC
		return await this.session.write({
			nodeId: item.nodeId,
			attributeId: opcua.AttributeIds.Value,
			value: new opcua.DataValue({
				value: new opcua.Variant({
					value: WriteValue,
					dataType: WriteDataType
				})
			})
		});
	}

	// Add item to monitor
	async addItemToMonitor(nodeId, callback){
		//Check if node is already monitored
		const item = this.FindMonitoredItem(nodeId);
		if(item !== undefined){
			logger.info("  |_ Item already monitored : " + nodeId);
			console.log(item);
			return;
		}

		const dataTypeId = await this.readDataType(nodeId);
		const dataType = opcua.coerceNodeId(dataTypeId.value);
		const values = await this.readData(nodeId);

		// Add item to monitor
		this.itemsToMonitor.push({
			nodeId: nodeId,
			attributeId: opcua.AttributeIds.Value,
			indexRange: null,
			dataEncoding: { namespaceIndex: 0, name: null },
			dataTypeId : dataTypeId.value,
			dataType : dataType,
			value : values.value
		});

		// Log the item	
		logger.info("  |_ Add item to monitor : " + nodeId);
	}

	getMonitoredItems(){
		return this.monitoredItems;
	}

	// Start monitoring data changes
	async startMonitoringDataChanges(){
		if( this.itemsToMonitor.length == 0 ){
			logger.info("  |_ No items to monitor (" + this.itemsToMonitor.length + ") !");
			return;
		}

		// Create a subscription
		logger.info("  |_ Create Subscription / Monitor items (" + this.itemsToMonitor.length + ") !")

		this.subscription = await this.session.createSubscription2({
			requestedPublishingInterval: 1000,
			requestedLifetimeCount: 100,
			requestedMaxKeepAliveCount: 30,
			maxNotificationsPerPublish: 10,
			publishingEnabled: true,
			priority: 10
		});

		// Log events
		this.subscription.on("started", function(){	            logger.info("  |_Subscription started !")} );
		this.subscription.on("keepalive", function(){	        logger.info("  |_Subscription keep alive : " + new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) )} );
		this.subscription.on("terminated", function(){	        logger.info("  |_Subscription terminated !")} );
		this.subscription.on("internal_error", function(){	    logger.info("  |_Subscription internal error !")} );
		this.subscription.on("status_changed", function(){	    logger.info("  |_Subscription status changed !")} );
		this.subscription.on("keepalive_failure", function(){	logger.info("  |_Subscription keep alive failure !")} );
		this.subscription.on("keepalive_success", function(){	logger.info("  |_Subscription keep alive success !")} );

		// Create monitored items
		this.monitoredItems = this.subscription.monitorItems(this.itemsToMonitor, {
			samplingInterval: 100,
			discardOldest: true,

			queueSize: 10
		}, opcua.TimestampsToReturn.Both, (err, monitoredItems) => {
			if(err) logger.info(err);

			// Log events
			monitoredItems.on("initialized", function(){	    logger.info("    |_Monitored items initialized !")} );
			monitoredItems.on("terminated", function(){	        logger.info("    |_Monitored items terminated !")} );

			monitoredItems.on("changed", (events, dataValue, index) => {
				logger.info("    |_ Item changed [" + index + "] " + events.itemToMonitor.nodeId );
				logger.info("      |_ Value : " + JSON.stringify(dataValue.value.value) );

				if( this.SocketIO && this.SocketEmitEvent ){
					this.SocketIO.sockets.emit('itemChanged', { nodeId: events.itemToMonitor.nodeId, value: dataValue.value.value } );
				}

				const item = {
					data: dataValue.value.value,
					index: index
				}
				return item;
			});
		});
	}

	#getCacheFilePath(){
		return this.cacheDirectory + '/' + this.cacheFile;
	}

	// Delete cache file
	async #deleteCacheFile(){
		const itemFile = this.#getCacheFilePath();

		if( !fs.existsSync(itemFile) ) return;

		logger.info("  |_ Delete cache file : " + itemFile);

		fs.unlink(itemFile, function(err) {
			if(err) 			logger.error("    |_ Delete cache file : KO | " + err);
			else				logger.info("    |_ Delete cache file : OK");
		});
	}

	// Write items to cache file
	async #writeItemsToCacheFile(){
		const itemFile = process.env.CACHE_DIR + '/' + process.env.CACHE_ITEMS_FILE;
		logger.info("  |_ Write cache file : " + itemFile);

		// Write items to file
		fs.writeFile(itemFile, JSON.stringify(this.itemsAvailable, null, 2), function(err) {
			if(err) 			logger.error("    |_ Write cache file : KO | " + err);
			else				logger.info("    |_ Write cache file : OK");
		});
	}

	getItemsAvailable(){
		return this.itemsAvailable();
	}

	// Get items from cache file
	async getItemsFromCacheFile(){
		if( this.currentBrowsing )		return 5;
		
		const itemFile = process.env.CACHE_DIR + '/' + process.env.CACHE_ITEMS_FILE;

		logger.info("  |_ Read cache file : " + itemFile);

		// Check if the file exists
		if( !fs.existsSync(itemFile) ){
			logger.error("    |_ File doest not exist : " + itemFile);
			return 6;
		}

		// Read the file
		try {
			const data = fs.readFileSync(itemFile, 'utf8')
			this.itemsAvailable = JSON.parse(data);
			logger.info("    |_ Read cache file : OK");
		} catch (err) {
			logger.error("    |_ Read cache file : KO | " + err);
		}

		return this.itemsAvailable;
	}

	async browse(rootNode, monitor=false){
		logger.info("  |_ Browsing root on : " + rootNode);
		await this.#browseNodeRecursiv( rootNode, 0, monitor ).then( () => {
			logger.info("    |_ Browsing OK, cache values");
			
			this.#writeItemsToCacheFile();
			this.currentBrowsing = false;
		});
	}

	async #browseNodeRecursiv(nodeId, level = 0, monitor=false){
		this.currentBrowsing = true;
		// Browse the data
		const browseResult = await this.session.browse(nodeId);

		// Log all the values
		for(var i = 0; i < browseResult.references.length; i++){
			// Read data and type of the node
			const dataTypeId = await this.readDataType(browseResult.references[i].nodeId);
			const dataType = opcua.coerceNodeId(dataTypeId.value);
			const values = await this.readData(browseResult.references[i].nodeId);

			const index = this.FindAvailableItemIndex(browseResult.references[i].nodeId);
			if( index != -1 ){
				// Update item
				this.itemsAvailable[index] = {
					node: browseResult.references[i],
					dataTypeId : dataTypeId.value,
					dataType : dataType,
					value : values.value
				}
			}else{
				// Add item to monitor
				this.itemsAvailable.push({
					node: browseResult.references[i],
					dataTypeId : dataTypeId.value,
					dataType : dataType,
					value : values.value
				});

				// Monitor the item if needed
				if( monitor ){
					this.addItemToMonitor(browseResult.references[i].nodeId);
				}
			}

			logger.debug(" ".repeat(level) + "    |_ Browse : " + browseResult.references[i].nodeId + " / " + browseResult.references[i].browseName.name + " (" + browseResult.references[i].nodeId.value + ")");
			await this.#browseNodeRecursiv(browseResult.references[i].nodeId, (level + 1));
		}
	}

	searchItemByNameLike(name){
		var result = [];
		for(var key in this.itemsAvailable){
			if(this.itemsAvailable[key].browseName.name.toLowerCase().includes(name.toLowerCase())){
				result.push(this.itemsAvailable[key]);
			}
		}
		return result;
	}
}

exports.WagoPLC = WagoPLC;
