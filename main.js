
const electron = require('electron')
console.log(electron);
// Module to control application life.
const app = electron.app;
console.log(app);
const globalShortcut = electron.globalShortcut;
//var Express = require('express');
//console.log(Express);
//var ExpressApp = Express();
//console.log(ExpressApp);
//ExpressApp.listen(3000, function () {
//    console.log('Example app listening on port 3000.');
//});
//ExpressApp.on( 'IncomingMessage', () => {console.log('incoming');});

var ArgumentParser = require('../node_modules/argparse').ArgumentParser;
var parser = new ArgumentParser({
  version: '0.0.1',
  addHelp:true,
  description: 'Argparse example'
});

parser.addArgument(
  [ '-c', '--CastVoice' ],
  {
	nargs: '0',
    help: 'CastVoice, invoke mp3 files via json post'
  }
);

parser.addArgument(
  [ '-d', '--Device' ],
  {
	nargs: '1',
    help: 'Device, device to cast to'
  }
);

parser.addArgument(
  [ '-p', '--Port' ],
  {
	nargs: '1',
    help: 'Port to run web server on'
  }
);
var args = parser.parseArgs();
console.log(args['CastVoice']);

// set CastVoice true if we want to do the json post to speech thing
// false if we want to do the streaming of all audio thing
var CastVoice = (args['CastVoice'] != null);
if (CastVoice) {
	console.log(' CastVoice specified');
} else {
	console.log(' CastVoice NOT specified');
}

// which device we want to cast to, specified on the command line rather
// than forcing the end user to pick from task bar.
var CastName = null;
var CastDevice = null;
var Port = null;
if (args['Device'] != null) {
	CastName = args['Device'];
	console.log(' Device ' + CastName);
} else {
	console.log(' Device NOT specified');
}

if (args['Port'] != null) {
	Port = args['Port'][0];
	console.log(' Port ' + Port);
} else {
	console.log(' Port NOT specified');
}

//Short code, use * as wildcard match
function matchRuleShort(str, rule) {
  return new RegExp("^" + rule.split("*").join(".*") + "$").test(str);
}


// Module to create native browser window.
const BrowserWindow = electron.BrowserWindow
import {
    Tray, Menu, MenuItem
}
from 'electron';
var lib;

var contextMenu = new Menu();
contextMenu.append(new MenuItem({
    type: 'separator'
}));
contextMenu.append(
    new MenuItem({
        label: process.platform === 'darwin' ? 'Use Volume Shortcuts (Alt+Command+U/D/M)' : 'Use Volume Shortcuts (Ctrl+Alt+U/D/M)',
        type: 'checkbox',
        click: () => {
            lib.volumeEnableShortCuts();
        }
    })
);
contextMenu.append(new MenuItem({
    type: 'separator'
}));

contextMenu.append(new MenuItem({
    type: 'normal',
    label: 'Close',
    click: () => {
        lib.quit();
        app.quit();
    }
}));
// contextMenu.append(
//     new MenuItem({
//         label: 'Toggle Developer Tools',
//         accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
//         click (item, focusedWindow) {
//             console.info(item, focusedWindow);
//             if (focusedWindow) focusedWindow.webContents.toggleDevTools();
//         }
//     })
// );

/* Some useful chrome args */
app.commandLine.appendSwitch('v', -1);
app.commandLine.appendSwitch('vmodule', 'console=0');
app.commandLine.appendSwitch('disable-speech-api');

app.on('ready', () => {
	
    globalShortcut.register(process.platform === 'darwin' ? 'Alt+Command+U' : 'Ctrl+Alt+U', () => {
        lib.volumeUp();
    })
    globalShortcut.register(process.platform === 'darwin' ? 'Alt+Command+D' : 'Ctrl+Alt+D', () => {
        lib.volumeDown();
    })
    globalShortcut.register(process.platform === 'darwin' ? 'Alt+Command+M' : 'Ctrl+Alt+M', () => {
        lib.volumeMute();
    })
    lib = require('./lib');
	if(!CastVoice)lib.InstallDriver();
	lib.SetPort(Port);
	lib.setupServer();
    console.info(process.cwd())
    const appIcon = new Tray('cast.png');
    appIcon.on('click', function(ev, bounds) {
        console.info(bounds);
       appIcon.popUpContextMenu(contextMenu, {x: bounds.x, y: bounds.y-bounds.height});
    });
    appIcon.on('right-click', function (ev, bounds) {
        console.info(ev, bounds);
       appIcon.popUpContextMenu(contextMenu, {x: bounds.x, y: bounds.y-(bounds.height*2)});
    })
    lib.on("deviceFound", (host, devicename) => {
        console.log(host, devicename);
		// fake a click if the user selected a default
		if(CastName != null && matchRuleShort(devicename,CastName.toString())) {
			contextMenu.insert(0, new MenuItem({
			label: devicename,
			type: 'checkbox',
			click: () => {
				console.log('click1');
				if (CastVoice) {
					CastDevice = host;
					lib.SetCastHost(host);
				} else {
					lib.stream(host);
				}
			}
			}));
			// fake a click
			if (CastVoice) {
				console.log('fake click');
				CastDevice = host;
				lib.SetCastHost(host);
			} else {
				console.log('fake stream');
				lib.stream(host);
			}
		} else {
			contextMenu.insert(0, new MenuItem({
				label: devicename,
				type: 'checkbox',
				checked: true,
				click: () => {
					console.log('click2');
					if (CastVoice) {
						CastDevice = host;
						lib.SetCastHost(host);
					} else {
						lib.stream(host);
					}
				}
			}));
		}
		
        appIcon.setContextMenu(contextMenu);
		// fake a click if the user selected a default
		if(CastName != null && matchRuleShort(devicename,CastName.toString())) {
			if (CastVoice) {
				CastDevice = host;
			} else {
				lib.stream(host);
			}
		}
    });
	


});

app.on('window-all-closed', app.quit);
