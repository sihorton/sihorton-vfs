var nodefs = require("fs");
var appfs = require("./sihorton-vfs.js");

appfs.Mount(__dirname+"\\new-example.appfs",function(vfs) {
	console.log("\t",true,"appfs mounted");
	//console.log(vfs.dirs);
	nodefs.stat("not_found",function(nerr,nstats) {
		vfs.stat("not_found",function(err,stats) {
			console.log("\t",nerr.errno==err.errno,"stat() - not found - errno");
			console.log("\t",nerr.code==err.code,"stat() - not found - code");	
		});
	});
	vfs.stat("package.json",function(err,stats) {
		console.log("\t",stats != undefined,"stat() - stats object returned");
	});
});