// Requires: node-opcua, winston
const opcua 		= require("node-opcua");
const fs 			= require("fs");
const EventEmitter 	= require('events');

require('dotenv').config();

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
class WagoPLC extends EventEmitter {
	// Wago variables
	ip = null;									// IP address of the PLC
	wLogin = null;								// Login of the PLC
	password = null;							// Password of the PLC
	session = null;								// Session with the PLC
	subscription = null;						// Subscription to the PLC
	itemsToMonitor = [];						// Array of items to monitor
	itemsAvailable = [];						// Array of items browsed from the PLC
	client = null;								// OPCUA client

	// Static variables
	cacheDirectory = "./cache";					// Cache directory for the OPCUA client
	cacheFile = "items.json";					// File to store the items browsed from the PLC

	// Others variables
	debug = false;						// Log events
	currentBrowsing = false;			// True if a browsing is in progress
	
	// Constructor with the IP address of the PLC, login and password
	constructor(ip, login, password){
		super();
	
		if( process.env.CACHE_DIR ) 			this.setCacheDirectory( process.env.CACHE_DIR );
		if( process.env.CACHE_FILE ) 			this.setCacheFile( process.env.CACHE_FILE );

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
		this.client.on("connected", function(){	                    	this.emit('log', " |_ Connected to OPCUA Server !")} );
		this.client.on("connection_failed", function(){	    			this.emit('error', " |_ Connection failed !")} );
		this.client.on("connection_lost", function(){	            	this.emit('error', "   |_ Connection lost !")} );
		this.client.on("close", function(){	                        	this.emit('log', "   |_ Close !")} );
		this.client.on("start_reconnection", function(){	        	this.emit('log', "   |_ Start reconnection !")} );
		this.client.on("after_reconnection", function(){	        	this.emit('log', "   |_ Reconnection OK !")} );
		this.client.on("backoff", function(){	                    	this.emit('log', "   |_ Backoff !")} );
		this.client.on("reconnection_attempt_has_failed", function(){	this.emit('log', "   |_ Reconnection attempt has failed !")} );
		this.client.on("abort", function(){	                        	this.emit('log', "   |_ Abort !")} );
		this.client.on("send_chunk", function(){	                	this.emit('log', "   |_ Send chunk !")} );
		this.client.on("receive_chunk", function(){	                	this.emit('log', "   |_ Receive chunk !")} );
		this.client.on("send_request", function(){	                	this.emit('log', "   |_ Send request !")} );
		this.client.on("receive_response", function(){	            	this.emit('log', "   |_ Receive response !")} );
		this.client.on("lifetime_75", function(){	                	this.emit('log', "   |_ Lifetime 75 !")} );
		this.client.on("security_token_renewed", function(){	    	this.emit('log', "   |_ Security token renewed !")} );
		this.client.on("connection_reestablished", function(){	    	this.emit('log', "   |_ Connection reestablished !")} );
		this.client.on("timed_out_request", function(){	            	this.emit('log', "   |_ Timed out request !")} );
	}

	setCacheDirectory(directory){
		this.cacheDirectory = directory;
	}

	setCacheFile(file){
		this.cacheFile = file;
	}

	ping(){
		const ping = this.session !== null && this.session.sessionId !== null;
		return ping;
	}

	isConnected(){
		return (this.session !== null && this.session.sessionId);
	}

	// Connect to the PLC with ip, create the session with login and password
	async connect(){
		// Connect to the PLC
		await this.client.connect(this.ip);

		// Create the session
		this.session = await this.client.createSession({userName: this.wLogin, password: this.password});

		// Log events : keepalive, keepalive_failure, session_closed, session_restored
		this.session.on("keepalive", function(){	                    this.emit('log', "    |_ Keepalive !")} );
		this.session.on("keepalive_failure", function(){	    		this.emit('error', "    |_ Keepalive failure !")} );
		this.session.on("session_closed", function(){	            	this.emit('error', "    |_ Session closed !")} );
		this.session.on("session_restored", function(){	            	this.emit('log', "    |_ Session restored !")} );
		
		this.emit("connected");
	}

	// Disconnect from the PLC
	async disconnect(){
		// Disconnect from the PLC
		await this.client.disconnect().then(() => {
			this.emit("disconnected");
		});
	}

	// Close session and subscription
	async close(){
		// Close the session if it exists
		if(this.session != null)		await this.session.close().then(() => {
			this.emit("session_closed");
		});

		// Close the subscription if it exists
		if(this.subscription != null)	await this.subscription.terminate().then(() => {
			this.emit("session_terminated");
		});
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

		return dataValue.value;
	}

	// Read data from the PLC. Return the value of the data
	async readDataType(nodeId){
		// Read the data
		const dataValue = await this.session.read({
			nodeId: nodeId,
			attributeId:opcua.AttributeIds.DataType
		});

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

		this.emit("beforeWrite", {who: who, what: what, item: item});

		if(item === false || item === undefined ){
			return;
		}

		var WriteValue = null;
		var WriteDataType = null;

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
				this.emit("error", "Write : Unknown data type")
				return false;
		}

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
		}).then((statusCode) => {
			this.emit("afterWrite", {"who": who, "what": what,  "item": item, "statusCode": statusCode});
		});
	}

	// Add item to monitor
	async addItemToMonitor(nodeId, dataTypeId=false, dataType=false, values=false){
		//Check if node is already monitored
		var item = this.FindMonitoredItem(nodeId);
		if(item !== undefined){
			this.emit('error', 'Item already monitored : ' + nodeId);
			return;
		}

		this.emit("beforeMonitorItem", nodeId);

		if( !dataTypeId )		dataTypeId = await this.readDataType(nodeId);
		if( !dataType )			dataType = opcua.coerceNodeId(dataTypeId.value);
		if( !values )			values = await this.readData(nodeId);

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

		this.emit("afterMonitorItem", nodeId);
	}

	getMonitoredItems(){
		return this.monitoredItems;
	}

	// Start monitoring data changes
	async startMonitoringDataChanges(){
		this.emit("beforeMonitoring");

		if( this.itemsToMonitor.length == 0 ){
			this.emit('error', 'No item to monitor !');
			return;
		}

		this.subscription = await this.session.createSubscription2({
			requestedPublishingInterval: 1000,
			requestedLifetimeCount: 100,
			requestedMaxKeepAliveCount: 30,
			maxNotificationsPerPublish: 10,
			publishingEnabled: true,
			priority: 10
		});

		// Log events
		this.subscription.on("started", function(){	            this.emit('log', "  |_ Subscription started"); } );
		this.subscription.on("keepalive", function(){	        this.emit('log', "  |_Subscription keep alive : " + new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) )} );
		this.subscription.on("terminated", function(){	        this.emit('log', "  |_Subscription terminated !")} );
		this.subscription.on("internal_error", function(){	    this.emit('log', "  |_Subscription internal error !")} );
		this.subscription.on("status_changed", function(){	    this.emit('log', "  |_Subscription status changed !")} );
		this.subscription.on("keepalive_failure", function(){	this.emit('log', "  |_Subscription keep alive failure !")} );
		this.subscription.on("keepalive_success", function(){	this.emit('log', "  |_Subscription keep alive success !")} );

		// Create monitored items
		this.monitoredItems = this.subscription.monitorItems(this.itemsToMonitor, {
			samplingInterval: 100,
			discardOldest: true,

			queueSize: 10
		}, opcua.TimestampsToReturn.Both, (err, monitoredItems) => {
			if(err)		 this.emit('error', err);

			// Log events
			monitoredItems.on("initialized", function(){	    this.emit('log', "      |_Monitored items initialized !")} );
			monitoredItems.on("terminated", function(){	        this.emit('log', "      |_Monitored items terminated !")} );

			monitoredItems.on("changed", (events, dataValue, index) => {
				this.emit("itemChanged", { "nodeId": events.itemToMonitor.nodeId, "value": dataValue.value.value });
			});
		});

		this.emit("afterMonitoring", this.itemsToMonitor.length);
	}

	#getCacheFilePath(){
		return this.cacheDirectory + '/' + this.cacheFile;
	}

	// Delete cache file
	async #deleteCacheFile(){
		const itemFile = this.#getCacheFilePath();

		if( !fs.existsSync(itemFile) ) return;

		fs.unlink(itemFile, function(err) {
			if(err) 			this.emit('error', "Delete cache file : KO | " + err)
		});
	}

	// Write items to cache file
	async #writeItemsToCacheFile(){
		const itemFile = process.env.CACHE_DIR + '/' + process.env.CACHE_ITEMS_FILE;

		// Write items to file
		fs.writeFile(itemFile, JSON.stringify(this.itemsAvailable, null, 2), function(err) {
			if(err) 			this.emit('error', "Write cache file : KO | " + err)
		});
	}

	getItemsAvailable(){
		return this.itemsAvailable;
	}

	// Get items from cache file
	async getItemsFromCacheFile(){
		if( this.currentBrowsing )		return 5;

		const itemFile = process.env.CACHE_DIR + '/' + process.env.CACHE_ITEMS_FILE;

		// Check if the file exists
		if( !fs.existsSync(itemFile) ){
			this.emit('error', 'Cache file not found !')
			return 6;
		}

		// Read the file
		try {
			const data = fs.readFileSync(itemFile, 'utf8')
			this.itemsAvailable = JSON.parse(data);
		} catch (err) {
			this.emit('error', 'Error reading cache file : ' + err)
		}

		return this.itemsAvailable;
	}

	async browse(rootNode, monitor=false){
		this.emit("beforeBrowsing", rootNode);

		await this.#browseNodeRecursiv( rootNode, 0, monitor ).then( () => {
			this.#writeItemsToCacheFile();
			this.currentBrowsing = false;
		});
		this.emit("afterBrowsing", rootNode);
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
					this.addItemToMonitor(browseResult.references[i].nodeId, dataTypeId, dataType, values);
				}
			}
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
