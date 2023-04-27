﻿# wagoplc-opcua-client

This is a librairy to connect to a WAGO PLC OPC-UA Server

## Examples

Here is a example to reach data :
```
// Check environment variables and exit if not set
if (!process.env.WAGO_OPCUA_HOST) {
	logger.error("WAGO_OPCUA_HOST environment variable not set");
	process.exit(1);
}

if (!process.env.WAGO_OPCUA_PORT) {
	logger.error("WAGO_OPCUA_PORT environment variable not set");
	process.exit(1);
}

if (!process.env.WAGO_BROWSE_NODES) {
	logger.error("WAGO_BROWSE_NODES environment variable not set");
	process.exit(1);
}

if (!process.env.WAGO_BROWSE_DELIMITER) {
	logger.error("WAGO_BROWSE_DELIMITER environment variable not set");
	process.exit(1);
}

if (!process.env.WAGO_MONITOR_BROWSED) {
	logger.error("WAGO_MONITOR_BROWSED environment variable not set");
	process.exit(1);
}

if (!process.env.WAGO_BROWSE_SCHEDULER_INTERVAL) {
	logger.error("WAGO_BROWSE_SCHEDULER_INTERVAL environment variable not set");
	process.exit(1);
}

// App to control the Wago PLC with OPC UA protocol
const WagoEndpointOPC = 'opc.tcp://' + process.env.WAGO_OPCUA_HOST + ':' + process.env.WAGO_OPCUA_PORT;
const WagoLogin = process.env.WAGO_OPCUA_USER || 'admin';
const WagoPassword = process.env.WAGO_OPCUA_PASS || 'password';

// Requires
const opcua = require("node-opcua-nodeid");
const { WagoPLC } = require('wagoplc-opcua-client');


/*** Launch the script ***/
// Create Wago PLC object
const wago = new WagoPLC(WagoEndpointOPC, WagoLogin, WagoPassword);
wago.setLogLevel(process.env.WAGO_LOG_LEVEL || 'info');
if( process.env.CACHE_DIR ) 			wago.setCacheDirectory( process.env.CACHE_DIR );
if( process.env.CACHE_FILE ) 			wago.setCacheFile( process.env.CACHE_FILE );
	
wago.connect().then(async () => {
	// Browse (recursively) multiple nodes and start monitoring data changes
	const nodes = process.env.WAGO_BROWSE_NODES.split( process.env.WAGO_BROWSE_DELIMITER );
	const scheduleIntervalMin = process.env.WAGO_BROWSE_SCHEDULER_INTERVAL;
	const scheduleIntervalMs = scheduleIntervalMin * 60 * 1000;

	for (const node of nodes) {
		// Browse once at start, set Monitor to true, or use addItemToMonitor after browse
		await wago.browse(node, process.env.WAGO_MONITOR_BROWSED=="true" ).then( async () => {
			logger.info("|_ Wago PLC browsed : " + node);
		});

		// Schedule browse if needed, without monitoring (monitoring is done at start)
		if( scheduleIntervalMin > 0 ){
			logger.info("|_ Wago PLC scheduler browsing : " + node + " every " + scheduleIntervalMin + " min");
			setInterval( async () => {
				await wago.browse(node, false )
			}, scheduleIntervalMs);
		}
	}

	// Start monitoring
	wago.startMonitoringDataChanges().then(() => {
		logger.info("WAGO PLC Monitoring started");
	});
});
```
