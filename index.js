// Requires: node-opcua, winston
const opcua = require("node-opcua-nodeid");
const { _enumerationDataChangeTrigger } = require("node-opcua-types");
const {
	OPCUAClient,
	AttributeIds,
	ClientSubscription,
	TimestampsToReturn,
	MessageSecurityMode,
	SecurityPolicy,
	MonitoringMode,
	BrowseDirection
} = require("node-opcua");

const { createLogger, format, transports } = require("winston");
 
// REquire printf
const { printf, combine, timestamp, label, prettyPrint } = format;

const logLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

// Logger format
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
	ip = null;							// IP address of the PLC
	wLogin = null;						// Login of the PLC
	password = null;					// Password of the PLC
	session = null;						// Session with the PLC
	subscription = null;				// Subscription to the PLC
	itemsToMonitor = [];				// Array of items to monitor
	itemsAvailable = [];				// Array of items browsed from the PLC
	client = null;						// OPCUA client
	
	// Others variables
	debug = false;						// Log events
	currentBrowsing = false;			// True if a browsing is in progress
	
	// Constructor with the IP address of the PLC, login and password
	constructor(ip, login, password){
        logger.info("=== WagoPLC constructor on : " + ip + " ===");

		this.debug = true;					// Log events

		this.ip = ip;
		this.wLogin = login;
		this.password = password;

		// Create OPCUA client
		this.client = OPCUAClient.create({
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

	logLevel(level){
		logger.level = level;
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

	// Read data from the PLC. Return the value of the data
	async readData(nodeId){
		// Read the data
		const dataValue = await this.session.read({
			nodeId: nodeId,
			attributeId: AttributeIds.Value
		});

		// Log the value
		logger.info("    |_ Read data : " + nodeId + " = " + dataValue.value);
		
		return dataValue.value.value;
	}

	// Add item to monitor
	async addItemToMonitor(nodeId, callback){
		// Add item to monitor
		this.itemsToMonitor.push({
			nodeId: nodeId,
			attributeId: AttributeIds.Value,
			indexRange: null,
			dataEncoding: { namespaceIndex: 0, name: null }
		});
		// Log the item	
		logger.info("  |_ Add item to monitor : " + nodeId);
	}

	// Start monitoring data changes
	async startMonitoringDataChanges(){
		// Create a subscription
		logger.info("  |_ Create Subscription / Monitor items !")

		this.subscription = await this.session.createSubscription2({
			requestedPublishingInterval: 1000,
			requestedLifetimeCount: 100,
			requestedMaxKeepAliveCount: 10,
			maxNotificationsPerPublish: 10,
			publishingEnabled: true,
			priority: 10
		});

		// Log events
		this.subscription.on("started", function(){	            logger.info("  |_Subscription started !")} );
		this.subscription.on("keepalive", function(){	        logger.info("  |_Subscription keep alive : " + new Dateé().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) )} );
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
		}, TimestampsToReturn.Both, (err, monitoredItems) => {
			if(err) logger.info(err);

			// Log events
			monitoredItems.on("initialized", function(){	    logger.info("    |_Monitored items initialized !")} );
			monitoredItems.on("terminated", function(){	        logger.info("    |_Monitored items terminated !")} );

			monitoredItems.on("changed", (events, dataValue, index) => {
				if( dataValue.value.value.nom && monitoredItemsValues[index] != dataValue.value.value.export_state ){
					logger.info("    |_ Item changed [" + index + "] " + dataValue.value.value.nom + " : " + dataValue.value.value.export_state);
					monitoredItemsValues[index] = dataValue.value.value.export_state;
				}
			});
		});
	}

    // Function schedule browse every 10 seconds
    scheduleBrowse(rootNode){
        // Browse the data
        this.browse(rootNode);

        // Schedule the next browse
        setTimeout(function(){ this.browse(rootNode) }, 10000);
    }

	async browse(rootNode){
        // Reset item available
        this.itemsAvailable = [];

		logger.info("  |_ Browsing root on : " + rootNode);
		this.browseNodeRecursiv( rootNode );
	}

	async browseNodeRecursiv(nodeId, level = 0){
		this.currentBrowsing = true;
		// Browse the data
		const browseResult = await this.session.browse(nodeId);

		// Log all the values
		for(var i = 0; i < browseResult.references.length; i++){
			// Save in itemsAvailable
			this.itemsAvailable[browseResult.references[i].nodeId.value] = browseResult.references[i];

			logger.debug(" ".repeat(level) + "    |_ Browse : " + browseResult.references[i].nodeId + " / " + browseResult.references[i].browseName.name + " (" + browseResult.references[i].nodeId.value + ")");
			await this.browseNodeRecursiv(browseResult.references[i].nodeId, (level + 1));
		}
		this.currentBrowsing = false;
	}
}

exports.WagoPLC = WagoPLC;