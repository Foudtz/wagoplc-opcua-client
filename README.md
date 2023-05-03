# wagoplc-opcua-client

This is a librairy to connect to a WAGO PLC OPC-UA Server

## Examples

Here is a example to reach data and update a MongoDB:
```
//...
const { WagoPLC } 	= require('wagoplc-opcua-client');

logger.info("[OPC]  |_ Starting OPCUA connection on : " + Environnement.Config.WAGO_OPCUA_HOST );
var wago = new WagoPLC(Environnement.Config.WAGO_OPCUA_URL, Environnement.Config.WAGO_OPCUA_USER, Environnement.Config.WAGO_OPCUA_PASS);
wago.connect().then(async () => {

	for (const node of process.env.WAGO_BROWSE_NODES.split( process.env.WAGO_BROWSE_DELIMITER )) {
		// Direct browsing and monitoring if needed
		await wago.browse(node, process.env.WAGO_MONITOR_BROWSED=="true" );

		// Schedule browse if needed, without monitoring (monitoring is done at start)
		if( Environnement.Config.WAGO_BROWSE_SCHEDULER_INTERVAL > 0 ){
			logger.info("[OPC]    |_ Scheduler browsing : " + node + " every " + Environnement.Config.WAGO_BROWSE_SCHEDULER_INTERVAL + " min");
			setInterval( async () => {
				await wago.browse(node, false)
			}, Environnement.Config.SCHEDULE_INTERVAL_MS);
		}
	}

	// Start monitoring
	wago.startMonitoringDataChanges();
	
	// No need to update database at starting with item list, because monitoring send all values at start
	wago.on("itemChanged", (item) => {
		logger.info("[OPC]      |_ Item changed : " + item.nodeId.toString() /*+ " = " + JSON.stringify(item.value)*/);
		const itemToSave = {
			nodeId: item.nodeId.toString(),
			value: item.value,
		};
		ItemController.updateItem(itemToSave);
	});

// Don't forget to close and disconnect when needed, or your PLC will keep connection and slow down
// 		wago.close();
//		wago.disconnect();
});
```
