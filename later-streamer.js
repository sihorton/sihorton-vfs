stream = require('stream').Stream;
/**
* Used to return a stream when we know we will actually get a handle
* to the stream sometime in the future.
*/
var streamLater = function () {
  this.readable = true;
  this.writable = true;
  this.waitingData;
  this.isEnded = false;
  this.streamNow;
  this.listeners = {};
};
//inherit from stream base class.
require('util').inherits(streamLater, stream);

streamLater.prototype.write = function (chunk,encoding) {
	console.log("streamLater told to write");
	if (this.streamNow) {
		console.log("sending via direct stream");
		//stream it on..
		this.streamNow.write(chunk,encoding);
	} else {
		if (typeof this.waitingData == 'undefined') {
			this.waitingData = chunk;
		} else {
			this.waitingData += chunk;
		}
	}
};

streamLater.prototype.end = function (chunk,encoding) {
	console.log("streamLater told to end");
	if (this.streamNow) {
		//we are already hooked up.
		this.streamNow.end(chunk, encoding);
		console.log("streamLater emitting close");
		this.emit('close');
	}
	this.isEnded = true;
}
/*
//terrible implementation for now!
streamLater.prototype.on = function(event,callback) {
	this.listeners[event] = callback;
}
streamLater.prototype.emit = function(event,data) {
	console.log("told to emit",event);
	if (this.listeners[event]) {
		this.listeners[event](data);
	}
}
*/
module.exports.streamLater = function() {
	return new streamLater();
}