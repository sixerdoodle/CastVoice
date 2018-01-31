# CastVoice

Make Google Home speak

<Stopped work on this, move to Google-Home-Notifier https://github.com/sixerdoodle/google-home-notifier >

Modifications to https://github.com/acidhax/chromecast-audio-stream that allow you to tell Google Home to speak pre-defined phrases

** fair warning ** this is currently a total hack job.  maybe someone with better java skills will pick up the idea and run with it

Running CastVoice creates a simple web server that accepts JSON request to play an MP3 and sends the request to the selected Chromecast device.  Came about because I wanted verbal feedback from IFTTT commands sent to Google Home.  For example "Ok Google, close the garage door" could then respond "the door closed" or "failed to close door" or "the door is not open" rather than the simple single response available on the IFTTT Google Home interface.

Start with Chromecast Audio stream, then replace main.js and lib.js with the included files, then recompile

this adds command line args:

--CastVoice       
    this is required!  (originally I wanted to maintain the Chromecast Audio Stream functionality too, but too hard for now)
--Device DevName  
    select the chromecast device to cast to, wildcards are OK, so something like --Device Google-Home-* is good
    Required unless you want to manually select the cast device from the tray icon like chromecast-audio-stream does
--Port n
    the port number for the web server accepting incoming JSON requests .  8080 or 8081 or the like is good
    connsider this required too

JSON requests

JSON requests should be POSTed to the URL created above, like http://localhost:8080/

Easy way to test is via TASKER.  Create a task per this:
Server:Port     http:/192.168.1.99:8080     (or whatever matches your machine and --Port setting)
Path            /
Data/File       {"SpeakMP3":"e:/words/Hello.mp3"}
Content Type    application/json

then run the task!  easy-peasy

The SpeakMP3 points to mp3 files to play located on the machine running CastVoice!  

SpeakMP3 can also be a JSON array of MP3's to play.  they will be played sequentially.  so something like {"SpeakMP3":["e:/words/TheDoorIs.mp3","e:/words/Closed.mp3"]}  I suggest going to http://soundoftext.com/ to convert text phrases to MP3's

MP3s strung together in one SpeakMP3 Post get appended together and sent as one cast stream (so no pauses between MP3s)

Back to back posts will disconnect betweeen posts so there's a beep and a slight pause

== Install instructions ==

Had to reinstall due to crashed HD, so here's what I had to do to reproduce

1 - Install Node.js

2 - Download chromecast-audio-stream-master.zip from https://github.com/acidhax/chromecast-audio-stream and unpack to \CastVoice\

3 - In \CastVoice\ top level (with the Gruntfile.js) do an npm install grunt

4 - then npm install grunt-cli

5 - then npm install electron-prebuilt

6 - replace the chromcast-audio-stream main.js and lib.js with mine

7 - npm install

8 - grunt

9 - kill the resulting run and restart with something like:
C:\CastVoice\node_modules\electron-prebuilt\dist\electron.exe c:\CastVoice\build\ --CastVoice --Device Chrome* --Port 8080

should be it!

