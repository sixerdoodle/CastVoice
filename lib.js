
import express from 'express';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import Promise from 'bluebird';
import mdns from 'mdns-js';
import ssdp from 'node-ssdp-lite';
import os from 'os';
import net from 'net';
import async from 'async';
import util from 'util';
import getPort from 'get-port';
import childProcess from 'child_process';
import storage from 'electron-json-storage';


import {
    EventEmitter
}
from 'events';

import {
    Client as castv2Client,
    DefaultMediaReceiver as castv2DefaultMediaReceiver
}
from 'castv2-client';

var wincmd;
try {
    wincmd = require('node-windows');
} catch (ex) {
    wincmd = null;
}
const ffmpegPath = path.join(process.cwd(), 'resources/bin/ffmpeg/', process.platform, 'ffmpeg');
const app = express();  //https://expressjs.com
var bodyParser = require('body-parser');  // npm install body-parser
app.use(bodyParser.json()); // for parsing application/json
var fs = require('fs');

//
var command;
var ffstream;
var CastHost;
var Port;
var CastMP3;
var MP3Stack = [];
var PlayerIdle;

var getFFmpegCommandWindows = () => {
    let newCommand = ffmpeg();
    newCommand.input('audio=virtual-audio-capturer')
    newCommand.inputFormat('dshow')
    newCommand.outputFormat("wav")
    .on('codecData', function(data) {
        console.log('Input is ' + data.audio + ' audio ');
    })
    .on('start', commandLine => {
        console.log('Spawned Ffmpeg with command: ' + commandLine);
    })
    .on('error', (err, one, two) => {
        console.log(two);
    })
    .on('end', () => {
        console.log("end");
    });

    return newCommand;
}

var getFFmpegCommandOSX = (soundflowerDevice) => {
    // ffmpeg -f avfoundation -i "none:{{SoundFlower INDEX}}" out.mp3
    let command = ffmpeg();
    command.setFfmpegPath(ffmpegPath);
    command.input('none:'+soundflowerDevice.index)
    .inputFormat('avfoundation')
    .outputFormat("adts")
    .outputOptions([
        "-strict -2",
        "-b:a 192k"
    ])
    .on('start', commandLine => {
        console.log('Spawned Ffmpeg with command: ' + commandLine);
    })
    .on('error', (err, one, two) => {
        console.log(two);
    })
    .on('end', () => {
        console.log("end");
    });

    return command;
}

var SoundFlowerDevice = "Soundflower (2ch)"

var getFFmpegDevicesOSX = () => {
    // ffmpeg -f avfoundation -list_devices true -i ""
    return new Promise((resolve, reject) => {
        console.log(ffmpegPath);
        let command = ffmpeg();
        command.setFfmpegPath(ffmpegPath)
        command.input("\"\"")
        command.inputFormat("avfoundation")
        .inputOptions([
            "-list_devices true",
        ])
        .on('start', commandLine => {
            console.log('Spawned Ffmpeg with command: ' + commandLine);
        })
        .on('error', (err, one, two) => {
            if (err & !two) {
                return reject();
            }
            var mode = null;
            var data = two.split("\n");
            var devices = [];
            for (var i = 0; i < data.length; i++) {
                var line = data[i];
                if (line.indexOf("AVFoundation input device @ ") > -1) {
                    // device
                    var device = line.substring(line.indexOf("]")+1).trim();
                    if (device.indexOf("AVFoundation video devices") > -1) {
                        // Video device list.
                        mode = "video";
                    } else if (device.indexOf("AVFoundation audio devices") > -1) {
                        // audio device list.
                        mode = "audio";
                    } else {
                        devices.push({type: mode, index: device.substring(1,2 ), name: device.substring(device.indexOf("]")+1).trim() });
                    }
                }
            }
            resolve(devices);
        })
        .on('end', (err) => {
            console.log("DEVICES:", err);
        });
        let ffstream = command.pipe();
    });
};

var getSoundflowerDevice = () => {
    return new Promise((resolve, reject) => {
        getFFmpegDevicesOSX().then((devices) => {
            for (var i = 0; i < devices.length; i++) {
                if (devices[i].type == "audio" && devices[i].name == SoundFlowerDevice) {
                    console.info("Soundflower available!");
                    return resolve(devices[i]);
                }
            }
            console.info("Soundflower not found!");
            reject();
        });
    });
}

var getSelectedAudioDeviceOSX = () => {
    return new Promise((resolve, reject) => {
        var exePath = path.join(process.cwd(), 'resources/bin/driver/', process.platform, 'audiodevice')
        var child = childProcess.execFile(exePath, ["output"], {}, function (error, stdout, stderr) {
            var device = stdout.trim().split("\n").join("");
            resolve(device);
        }.bind(this));
    });
}

var originalOutputDevice;
getSelectedAudioDeviceOSX(true).then(function (audiodevice) {
    console.info("Selected Audio Device:", audiodevice);
    originalOutputDevice = audiodevice;
});

var setSelectedAudioDeviceOSX = (device) => {
    if (!device) {
        device = SoundFlowerDevice;
    }
    return new Promise((resolve, reject) => {
        var exePath = path.join(process.cwd(), 'resources/bin/driver/', process.platform, 'audiodevice')
        var child = childProcess.execFile(exePath, ["output", SoundFlowerDevice], {}, function (error, stdout, stderr) {
            getSelectedAudioDeviceOSX().then(function (activeDevice) {
                console.log(activeDevice, device);
                if (activeDevice != device) {
                    // SoundFlower not installed. Probably.
                    console.error("Soundflower not found!");
                    reject();
                } else {
                    // SoundFlower installed!
                    console.info("SoundFlower Activated!");
                    resolve();
                }
            });
        }.bind(this));
    });
};

class App extends EventEmitter {
    constructor() {
        super();
        this.expectedConnections = 0;
        this.currentConnections = 0;
        this.activeConnections = [];
        this.requests = [];

        this.connectedHosts = {};

        this.port = false;
        this.devices = [];
        this.server = false;
        this.volumeShortcutsEnabled = false;
		PlayerIdle = 'FINISHED';

        this.init();
        storage.get('device-cache', (error, data) => {
            if (!error && data) {
                for (var host in data) {
                    this.ondeviceup(host, data[host]);
                }
            }
		});
        this.on("deviceFound", this.cacheDevice.bind(this));
		this.on('DeviceIdle', () => {
					CastMP3 = MP3Stack.pop();		// grab the next list of mp3's to say
					console.log("223-popped ",CastMP3, " ",PlayerIdle);
					if (CastMP3 != undefined) { 	// if the pop returned something then Cast it
						PlayerIdle = 'IDLE';		// move from Finished to Idle since we're starting a new stream
						console.log('225-start cast:', CastHost, " ",PlayerIdle);
						this.stream(CastHost);  // this starts the playback
						console.log('227-end cast:', CastHost, " ",PlayerIdle);
					}
                    console.log('229----- Device is idle ------ ',PlayerIdle );
                })
        
        app.get('/', this.onRequest.bind(this));	// get requests to the web server go here
		app.post('/', this.onPost.bind(this));		// post requests go here
    }
	

    init() {
//        this.setupServer();
//            .then(this.detectVirtualAudioDevice.bind(this))
 //           .catch(console.error);
    }
	
	//
	// Incoming JSON request of what needs to be 'said'.
	//
	onPost(req,res) {

//			console.log('incoming',res.req.headers); 
			console.log(req.body); // this contains the MP3 we need to play, http://soundoftext.com/
			console.log("250-PlayerIdle=",PlayerIdle);
			console.log("251-push ",req.body.SpeakMP3);
			res.send("OK");
			MP3Stack.push(req.body.SpeakMP3);
			if(MP3Stack.length == 1 && PlayerIdle == 'FINISHED'){ 
				console.log("255-manual trigger emit");
				this.emit("DeviceIdle"); // if this is first element and we're done playing already, then manually trigger so we start the sequence
			}  
			console.log("258-PlayerIdle=",PlayerIdle);
	}

	//
	// here is where the cast devices comes to get the file we told them to 'say'
	//
    onRequest(req, res) {
        console.log("265-Device requested: /", res.req.headers);
        req.connection.setTimeout(Number.MAX_SAFE_INTEGER);
        this.requests.push({req: req, res: res});
        var pos = this.requests.length-1;
        req.on("close", () => {
            console.info("CLOSED", this.requests.length);
            this.requests.splice(pos,1);
            console.info("CLOSED", this.requests.length);
        });
        if (process.platform == "darwin") {
            getSoundflowerDevice().then((device) => {
                // passed
                setSelectedAudioDeviceOSX(SoundFlowerDevice);
                var command = getFFmpegCommandOSX(device)
                let ffstream = command.pipe();
                ffstream.on('data', res.write.bind(res));
            }, () => {
                // rejected
            })
        } else {
            console.info("this.activeConnections", this.activeConnections.length);
            //console.info("Requests", this.requests);
			res.set({'Content-Type': 'audio/mpeg'});

			//

			if(typeof CastMP3 === 'string') {	// single file is simple
				console.log("292-",CastMP3);
				var readStream = fs.createReadStream(CastMP3);
				readStream.on('end', () => {
					console.log('295-Stream end, no more data single file');
				});
				readStream.pipe(res,function() {
						console.log('298-completed');
					});
			} else {							// append multiple files together and send temp, then del temp
				for( var ii in CastMP3){
					if(ii==0){
						fs.writeFileSync(process.env.TEMP+'/temp.mp3',fs.readFileSync(CastMP3[ii]));
					} else {
						fs.appendFileSync(process.env.TEMP+'/temp.mp3',fs.readFileSync(CastMP3[ii]));
					}
				}
				var readStream = fs.createReadStream(process.env.TEMP+'/temp.mp3');
				readStream.on('end', () => {
					fs.unlink(process.env.TEMP+'/temp.mp3');
					console.log('311-Stream end, no more data.');
				});
				readStream.pipe(res,function() {
						console.log('314-completed');
					});
			}
        }
    }

    cacheDevice(host, name) {
        storage.get('device-cache', function(error, data) {
          if (!error) {
            data = data || {};
            if (!data[host]) {
                data[host] = name;
                storage.set('device-cache', data);
            }
          }
        });
    }

    setupServer() {
    /*    return new Promise((resolve, reject) => {
           getPort()
                .then(port => {
                    this.port = port;
                    this.server = app.listen(port, () => {
                        console.info('Example app listening at http://%s:%s', this.getIp(), port);
                    });
                    resolve()
                })
                .catch(reject);
        });
		*/
		console.log('in setup Port=',Port);
		var p = Port;
		console.log(p);
		this.port = p;
		this.server = app.listen(p, () => {console.info('CastVoice App listening at http://%s:%s', this.getIp(), p);});
    }

    detectVirtualAudioDevice(redetection) {
        if (process.platform == "darwin") {
            return this.detectVirtualAudioDeviceOSX();
        } else {
            return this.detectVirtualAudioDeviceWindows();
        }
    }

    detectVirtualAudioDeviceWindows (redetection) {
        let command = ffmpeg("dummy");
        command.setFfmpegPath(ffmpegPath);
        command.inputOptions([
            "-list_devices true",
            "-f dshow",
        ])
        return new Promise((resolve, reject) => {
            command.outputOptions([])
                .on('start', commandLine => {
                    console.log('Spawned Ffmpeg with command: ' + commandLine);
                })
                .on('error', (err, one, two) => {
                    if (one, two) {
                        if (two.indexOf("virtual-audio-capturer") > -1) {
                            console.log("VIRTUAL DEVICE FOUND");
                            resolve();
                        } else if (redetection) {
                            let err = "Please re-run application and temporarily allow Administrator to install Virtual Audio Driver.";
                            console.log(err);
                            reject(err);
                        } else {
                            var exePath = '"' +path.join(process.cwd(), 'resources/bin/driver/', process.platform, 'RegSvrEx.exe') + '"';
                            var dllPath = '"' +path.join(process.cwd(), 'resources/bin/driver/', process.platform, 'audio_sniffer.dll') + '"';
                            console.log(exePath + " /c " + dllPath)
                            var child = childProcess.exec(exePath + " /c " + dllPath, function (error, stdout, stderr) {
                                console.log('stdout: ' + stdout);
                                console.log('stderr: ' + stderr);
                                if (error !== null) {
                                  console.log('exec error: ' + error);
                                }
                                this.detectVirtualAudioDevice(true);
                            }.bind(this));
                        }
                    }
                })
                .on('end', () => {
                    console.log('end');
                })
            let ffstream = command.pipe();
        });
    }

    detectVirtualAudioDeviceOSX (redetection) {
        // ffmpeg -f avfoundation -list_devices true -i ""
        // ffmpeg -f avfoundation -i "none:{{SoundFlower INDEX}}" out.mp3
    }

    ondeviceup(host, name) {
        if (this.devices.indexOf(host) == -1) {
            this.devices.push(host);
            if (name) {
                this.emit("deviceFound", host, name);
            }
        }
    }
    getIp() {
        var ip = false
        var alias = 0;
        let ifaces = os.networkInterfaces();
        for (var dev in ifaces) {
            ifaces[dev].forEach(details => {
                if (details.family === 'IPv4') {
                    if (!/(loopback|vmware|internal|hamachi|vboxnet|virtualbox)/gi.test(dev + (alias ? ':' + alias : ''))) {
                        if (details.address.substring(0, 8) === '192.168.' ||
                            details.address.substring(0, 7) === '172.16.' ||
                            details.address.substring(0, 5) === '10.0.'
                        ) {
                            ip = details.address;
                            ++alias;
                        }
                    }
                }
            });
        }
        return ip;
    }
    searchForDevices() {
        let browser = mdns.createBrowser(mdns.tcp('googlecast'));
        browser.on('ready', browser.discover);

        browser.on('update', (service) => {
            if (service.addresses && service.fullname) {
                this.ondeviceup(service.addresses[0], service.fullname.substring(0, service.fullname.indexOf("._googlecast")));
            }
        });
		
		// also do a SSDP/UPnP search
		let ssdpBrowser = new ssdp();
		ssdpBrowser.on('response', (msg, rinfo) => {
			var location = this.getLocation(msg);
			if (location != null) {
				this.getServiceDescription(location, rinfo.address);
			}
		});

		ssdpBrowser.search('urn:dial-multiscreen-org:device:dial:1');
    }
	
	SetCastHost(s) {
		CastHost = s;
	}
	
	SetPort(p) {
		console.log('set port to ',p);
		Port = p;
	}
	
    stream(host) {
        let client = new castv2Client();
        client.volume = 0;
        client.stepInterval = 0.5;
        client.muted = false;
		console.log('473-stream called',host,' client ', typeof client);

        client.connect(host, () => {
            console.log('476-connected, launching app ...', 'http://' + this.getIp() + ':' + this.server.address().port + '/');
            if (!this.connectedHosts[host]) {
                this.connectedHosts[host] = client;
                this.activeConnections.push(client);
            }
            this.loadMedia(client);
        });
        client.on('close', ()  => {
            console.info("484-Client Closed, PlayerState=",this.PlayerState," PlayerIdle=",PlayerIdle);
            for (var i = this.activeConnections.length - 1; i >= 0; i--) {
                if (this.activeConnections[i] == client) {
                    this.activeConnections.splice(i,1);
                    return;
                }
            }
        });
        client.on('error', err => {
            console.log('493-Client Error: %s', err.message," PlayerState=",this.PlayerState," PlayerIdle=",PlayerIdle);
            client.close();
            delete this.connectedHosts[host];
        });
    }
	
    loadMedia(client, cb) {
        client.launch(castv2DefaultMediaReceiver, (err, player) => {
            if (!err && player) {
                let media = {
                    // Here you can plug an URL to any mp4, webm, mp3 or jpg file with the proper contentType.
                    contentId: 'http://' + this.getIp() + ':' + this.server.address().port + '/',
                    contentType: 'audio/mp3',
                    streamType: 'BUFFERED', // or LIVE

                    // Title and cover displayed while buffering
                    metadata: {
                        type: 0,
                        metadataType: 0,
                        title: "Audio Caster",
                    }
                };

                player.on('status', status => {
					console.log('518-on typeof status =',typeof status);
					console.log('519-on status =',status);
					if(status !== null && typeof status === 'object'){
						console.log('521-status broadcast player State=%s', status.playerState);
						PlayerIdle = status.playerState;
						if(status.idleReason != null && status.idleReason == 'FINISHED'){
							console.log("523-auto emit");
							PlayerIdle = 'FINISHED';
							this.emit("DeviceIdle");
						}
					}
                });

                console.log('app "%s" launched, loading media %s ...', player, media.contentId);

                player.load(media, {
                    autoplay: true
                }, (err, status) => {
					console.log('536-load typeof status =',typeof status);
					console.log('537-load status =',status);
					if(status !== null && typeof status === 'object'){
						console.log('539-media loaded playerState=%s', status.playerState);
						PlayerIdle = status.playerState;
						if(status.idleReason != null && status.idleReason == 'FINISHED'){
							console.log("541-auto emit");
							PlayerIdle = 'FINISHED';
							this.emit("DeviceIdle");
						}
					}
                });

                client.getStatus((x, status) => {
                    if (status && status.volume)
                    {
                        client.volume = status.volume.level;
                        client.muted = status.volume.muted;
                        client.stepInterval = status.volume.stepInterval;
                    }
                })
            }
            cb && cb(err, player);
        });
    }
	
	
    reloadFFmpeg(cb) {
        this.requests.forEach((item) => {
            item.res.end();
        });
        this.requests = [];
        async.each(this.activeConnections, (client, cb) => {
            loadMedia(client, cb);
        }, cb);
    }
	getLocation(msg) {
		msg.replace('\r', '');
		var headers = msg.split('\n');
		var location = null;
		for (var i = 0; i < headers.length; i++) {
			if (headers[i].indexOf('LOCATION') == 0)
				location = headers[i].replace('LOCATION:', '').trim();
		}
		return location;
	}
	parseServiceDescription(body, address) {
		var parseString = require('xml2js').parseString;
		parseString(body, (err, result) => {
			if (!err && result && result.root && result.root.device) {
				var device = result.root.device[0];
				this.ondeviceup(address, device.friendlyName.toString());
			}
		});
	}
	getServiceDescription(url, address) {
		var request = require('request');
		request.get(url, (error, response, body) => {
			if (!error && response.statusCode == 200) {
				this.parseServiceDescription(body, address);
			}
		});
	}
    setVolume() {
        if (this.volumeShortcutsEnabled) {
            async.each(this.activeConnections, (client) => {
                client.setVolume({ level: client.volume }, function (data, volume) { });
            });
        }
    }
    volumeUp() {
        if (this.volumeShortcutsEnabled) {
            async.each(this.activeConnections, (client) => {
                client.volume += client.stepInterval;
                if (client.volume > 1) client.volume = 1;
                this.setVolume();
            });
        }
    }
    volumeDown() {
        if (this.volumeShortcutsEnabled) {
            async.each(this.activeConnections, (client) => {
                client.volume -= client.stepInterval;
                if (client.volume < 0) client.volume = 0;
                this.setVolume();
            });
        }
    }
    volumeMute() {
        if (this.volumeShortcutsEnabled) {
            async.each(this.activeConnections, (client) => {
                client.muted = !client.muted;
                client.setVolume({ muted: client.muted }, function (data, volume) { });
            });
        }
    }
    volumeEnableShortCuts() {
        this.volumeShortcutsEnabled = !this.volumeShortcutsEnabled;
    }
    quit () {
        async.each(this.activeConnections, (client, cb) => {
            cb();
        });
    }
//only install the DLL if not running CastVoice

	InstallDriver() {
		// Just install the dll every time it launches.
		var exePath = '"' +path.join(process.cwd(), 'resources/bin/driver/', process.platform, 'RegSvrEx.exe') + '"';
		var dllPath = '"' +path.join(process.cwd(), 'resources/bin/driver/', process.platform, 'audio_sniffer.dll') + '"';
		console.log(exePath + " /c " + dllPath)
		var child = childProcess.exec(exePath + " /c " + dllPath);
	}

}

let instance = new App();
instance.searchForDevices();

module.exports = instance;
