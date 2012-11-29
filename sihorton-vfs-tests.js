var appfs = require("./sihorton-vfs.js");

var vfs = appfs.Mount(__dirname+"\\new-example.appfs",function(vfs) {
	console.log("test1:mounted ok.");
});