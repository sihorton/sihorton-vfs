var fs = require('fs')
	path = require('path');

/**
* A virtual file system served from a file on disk.
*/
var vfs = function(mountpath, stats, readyCall) {
	var Me = {
		mountpath:mountpath
		,msize:stats.size
		/* footer info    */
		,footerSize:(4*3)+16
		,dirPos:undefined
		,fileFormatv:0
		,flagv:0
		,dirs:undefined
		/* footer info end*/
		,_readFooter:function(footerRead) {
			var readStream = fs.createReadStream(Me.mountpath,{start:Me.msize-Me.footerSize});
			readStream.on('data', function(buff) {
				//assume it reads the whole footer in one go.
				var offset = 0;
				var str = buff.slice(0,16).toString();offset+=16;
				Me.dirPos = buff.readUInt32LE(offset);offset+=4;
				Me.fileFormatv = buff.readUInt32LE(0);offset+=4;
				Me.flagv = buff.readUInt32LE(0);offset+=4;
			});
			readStream.on('end',function() {
				//we read in the whole buffer.
				//read the directory listing and cache it.
				var readDir = fs.createReadStream(Me.mountpath,{start:Me.dirPos,end:Me.msize-(Me.footerSize+1)});
				var dat = '';
				readDir.on('data',function(data) {
					dat+=data;
				});
				readDir.on('end',function() {
					//we have now read in the buffer.
					Me.dirs = JSON.parse(dat);
					if (readyCall) readyCall(Me);
			
				});
			});
		}
	}
	Me._readFooter(function() {
	
	});
	//return Me;
}
/**
* Wrapper for a real directory on disk.
*/
var dirfs = function(mountpoint) {
	var Me = {
		basePath:mountpoint
	}
	return Me;
}
/**
* mount a file system from a particular path
* if directory provide an fs wrapper, if file open
* and provide vfs object.
*/
module.exports.Mount = function(mountpath, readyCall) {
	fs.stat(mountpath,function(err,stats) {
		if (err) console.log(err);
		if (stats.isDirectory()) {
			//passed a real directory on disk, return wrapper.
			var actual = dirfs(mountpath);
			if (readyCall) {
				readyCall(null, actual);
			}
		}
		if (stats.isFile()) {
			//find format from extension?
			switch(path.extname(mountpath)) {
				case '.appfs':
					//an application resource package.
					var virtual = new vfs(mountpath, stats,function(appfs){
						console.log("opened");
					});
				break;
				default:
					throw "unknown format:"+mountpath;
				break;
			}
		}
	});
}