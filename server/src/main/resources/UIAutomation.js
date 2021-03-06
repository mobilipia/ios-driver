function UIAutomationException(message, status) {
	this.message = message;
	this.status = status || 13;

	this.toString = function() {
		return this.message;
	}
}

function log(msg) {
	UIALogger.logMessage("log:" + msg);
}

var Cache = function() {
	this.storage = {};
	this.lastReference = 3;

	this.store = function(element) {
		if(element && element.type && element.type() === "UIAApplication") {
			var id = 1;
			element.id = id;
			return id;
		} else {
			this.lastReference++;
			element.id = this.lastReference;
			this.storage[this.lastReference] = element;
			return element.id;
		}

	};

	this.get = function(reference, opt_checkStale) {
		var checkStale = true;
		if(opt_checkStale === false) {
			checkStale = false;
		}
		if(reference == 0) {
			return UIATarget.localTarget().frontMostApp().mainWindow();
		} else if(reference == 1) {
			return UIATarget.localTarget().frontMostApp();
		} else if(reference == 2) {
			return UIATarget.localTarget();
		} else if(reference == 3) {
			if(this.storage[3]) {
				return this.storage[3];
			} else {
				throw new UIAutomationException("No alert opened", 27);
			}

		}

		var res = this.storage[reference];

		// there is an alert.
		if(this.storage[3]) {

			if(res.isInAlert()) {
				return res;
			} else {
				throw new UIAutomationException("cannot interact with object " + res + ". There is an alert.", 26);
			}

		} else {
			// target and app aren't stale.
			if(!res) {
				throw new UIAutomationException("can't find " + reference + " in cache.");
				// window an apps aren't stale ?
			} else if(res.type && (res.type() == "UIAWindow" || res.type() == "UIAApplication")) {
				return res;
				// on arrays, stale doesn't make sense.
			} else if(checkStale && res.isStale && res.isStale()) {
				throw new UIAutomationException("elements ref:" + reference + " is stale", 10);
			} else {
				return res;
			}
		}

	};

	this.getAlert = function() {
		return this.storage[3];
	};
	this.setAlert = function(alert) {
		this.storage[3] = alert;
		log("found alert");
	};

	this.clearAlert = function() {
		log("removed alert");
		this.storage[3] = null;
	}

	this.clear = function() {
		this.storage = {};
		this.storage[0] = UIATarget.localTarget().frontMostApp().mainWindow();
	};

	this.clear();

}
/**
 * global variable.
 */
var UIAutomation = {
	cache : new Cache(),
	CURL : "/usr/bin/curl",
	COMMAND : "http://localhost:$PORT/wd/hub/uiascriptproxy?sessionId=$SESSION",
	HOST : UIATarget.localTarget().host(),
	TIMEOUT_IN_SEC : {
		"implicit" : 0
	},
	SESSION : "$SESSION",
	CAPABILITIES : -1,

	createJSONResponse : function(sessionId, status, value) {
		var result = {};
		result.sessionId = sessionId;
		result.status = status;
		var res = {};
		try {
			if(value && value.type && (value.type() === "UIAElementArray")) {
				var all = new Array();
				value = value.toArray();
				for(var i = 0; i < value.length; i++) {
					var current = value[i];
					var item = {};
					item.ELEMENT = "" + current.reference();
					item.type = current.type();
					all.push(item);
				}
				res = all;
			} else if(value && value.type) {
				// res.ref = value.reference();
				res.ELEMENT = "" + value.reference();
				res.type = value.type();
			} else {
				res = value;
			}
			result.value = res;
		} catch (err) {
			result.value = err;
		}

		var json = JSON.stringify(result);
		return json;
	},
	postResponseAndGetNextCommand : function(jsonResponse) {
		log("posting response : " + jsonResponse);
		var nextCommand = this.HOST.performTaskWithPathArgumentsTimeout(this.CURL, [this.COMMAND, "--data-binary", jsonResponse], 600);
		if(nextCommand.exitCode != 0) {
			throw new UIAutomationException("error getting new command. exit code : " + result.exitCode);
		}
		log("command : " + nextCommand.stdout);
		return nextCommand.stdout;

	},
	loadCapabilities : function() {
		var result = new Object();
		var target = UIATarget.localTarget();
		var app = target.frontMostApp();

		// en , fr ...
		result.language = app.preferencesValueForKey("AppleLanguages")[0];
		// en_GB
		result.locale = app.preferencesValueForKey("AppleLocale");
		result.version = app.version();
		result.CFBundleIdentifier = app.bundleID();
		result.CFBundleVersion = app.bundleVersion();
		result.device = target.model();
		result.name = target.name();
		result.systemName = target.systemName();
		result.sdkVersion = target.systemVersion();
		result.aut = "$AUT";
		result.rect = target.rect();
		return result;
	},
	getCapabilities : function() {
		if(this.CAPABILITIES === -1) {
			this.CAPABILITIES = this.loadCapabilities();
		}
		var result = this.CAPABILITIES;
		var target = UIATarget.localTarget();
		result.rect = target.rect();
		return result;
	},
	setTimeout : function(type, timeoutInSeconds) {
		this.TIMEOUT_IN_SEC[type] = timeoutInSeconds;
	},
	getTimeout : function(type) {
		return this.TIMEOUT_IN_SEC[type];
	},
	setAlertHandler : function() {
		UIATarget.onAlert = function onAlert(alert) {
			UIAutomation.cache.setAlert(alert);
			return true;
		}
	},
	commandLoop : function() {
		// first command after registration sends the capabilities.
		var init = {};
		init.firstResponse = UIAutomation.getCapabilities();
		var response = this.createJSONResponse(this.SESSION, 0, init);
		var ok = true;
		while(ok) {
			try {
				var request = this.postResponseAndGetNextCommand(response);
				if(request === "stop") {
					ok = false;
					log("end of the command loop.");

					return;
				} else {
					try {
						response = eval(request);
					} catch (err) {
						log("err1 : " + JSON.stringify(err));
						response = this.createJSONResponse(this.SESSION, err.status, err);
					}
				}
			} catch (err) {
				var response = this.createJSONResponse(this.SESSION, 13, err);
				log("err2 : " + JSON.stringify(err));
				return;
			}
		}
	}
};
