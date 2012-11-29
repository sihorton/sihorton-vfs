var fs = require('fs')
	path = require('path');

/**
* A virtual file system served from a file on disk.
*/
var appfs = function(mountpath, stats, readyCall) {
	var Me = {
		mountpath:mountpath
		,msize:stats.size
		,mstatus:0
		,autoClose:true//automatically write the footer after each write
		//if this is not true then you can get corrupted files
		//but performance is lower.
		
		// footer info
		,footerOnDisk:false
		,footerModified:true
		,formatName:'a'
		,formatSize:16
		,footerSize:(4*3)+16
		,dirPos:0
		,fileFormatv:0
		,flagv:0
		,dirs:{}
		// footer info end
		
		/**
		*_readFooter reads in the footer information and the directory listing
		* no need to call this directly, it is done when the file is mounted.
		*/
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
					//we have now read in the directory listing.
					Me.dirs = JSON.parse(dat);
					Me.footerOnDisk = true;
					Me.footerModified = false;
					//tell caller we are ready.
					if (footerRead) footerRead(Me);
			
				});
			});
		}
		/**
		*_writeFooter writes footer info to file
		* no need to call this directly, it is called through other methods.
		*/
		,_writeFooter:function(footerWritten) {
			//just to be safe re-stat to find size.
			fs.stat(Me.mountpath,function(err,stats) {
			Me.dirPos = stats.size;
				var footer1 = fs.createWriteStream(Me.mountpath,{flags:'a'});
				footer1.write(JSON.stringify(Me.dirs));
				
				//write buffer record..
				var Buffer = require('buffer').Buffer;
				var bundleRecord = new Buffer(Me.footerSize);
				
				var offset = 0;
				var writeInt32 = function (buffer, data) {
					buffer[offset] = data & 0xff;
					buffer[offset + 1] = (data & 0xff00) >> 0x08;
					buffer[offset + 2] = (data & 0xff0000) >> 0x10;
					buffer[offset + 3] = (data & 0xff000000) >> 0x18;
					offset += 4;        
				};
				var writeString = function(buffer, str,size) {
					var strBuf = new Buffer(size);
					strBuf.fill(" ");
					strBuf.write(str);
					buffer.write(strBuf.toString(),offset,offset+size);
					offset += size;
				}
						
				writeString(bundleRecord,Me.formatName,Me.formatSize);
				writeInt32(bundleRecord,Me.dirPos);
				writeInt32(bundleRecord,Me.fileFormatv);
				writeInt32(bundleRecord,Me.flagv);
				footer1.write(bundleRecord);
				footer1.end();
				if (typeof footerWritten != 'undefined') {
					footerWritten();
				}
			});
		}
		/* virtual file system, replicate fs style api */
		,stat:function(fpath, statCalling) {
			if (Me.dirs[fpath]) {
				statCalling(null,Me.dirs[fpath]);
			} else {
				//simulate read error
				var err = new Error("ENOENT, stat '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				statCalling(err);
			}
		},createReadStream:function(fpath,options) {
			/**
			* http://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options
			* @ToDo support options.
			*/
			if (Me.dirs[fpath]) {
				var f = Me.dirs[fpath];
				if (f.start == f.end) {
					//cannot read 0 bytes so use a dummy zero length file instead.
					var zeroLengthFile = function () {
					  this.readable = true;
					};
					require('util').inherits(zeroLengthFile,require('stream'));
					return new zeroLengthFile();
				} else {
					if (typeof options == 'undefined') {
						options = {start:0,end:0};
					}
					if (!options['start'])options.start = 0;
					if (!options['end'])options.end = 0;
					
					options.start += f.start;
					options.end += f.end-1;
					if (options.end > f.end) {
						options.end = f.end-1;
					}
					return fs.createReadStream(Me.mountpath,options);
				}
			} else {
				//@ToDo: create a new file
				var err = new Error("ENOENT, open '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				throw err;
			}
		},createWriteStream:function(fpath, options) {
			if (Me.dirs[fpath]) {
				throw "File Exists!";
			}
			//options not supported yet..
			var fileStartPos = Me.dirPos;//or msize...
			if (Me.footerOnDisk == true) {
				//the footer is on disk, but now we want to append to the file.
				//remove the footer and then allow writing.
				var later = require("./later-streamer.js").streamLater();
				Me.footerOnDisk=false;
				Me.footerModified=true;
				fs.open(Me.mountpath,'r+',undefined,function(err,fd) {
					if (err) throw err;
					fs.truncate(fd,Me.dirPos,function() {
						console.log("removed footer");
						//take any stream data and do stuff with it...
						var write1 = fs.createWriteStream(Me.mountpath,{flags:'a'});
						write1.on('close',function(err) {
						
							//add file information to the directory.
							console.log("write stream complete",fpath);
							var now = new Date().getTime();
							Me.dirs[fpath] = {
								size:write1.bytesWritten
								,start:fileStartPos
								,end:fileStartPos+write1.bytesWritten
								,name:path.basename(fpath)
								,atime:now
								,mtime:now
								,ctime:now
							}
							console.log(Me.dirs);
							//update settings
							Me.msize = fileStartPos+write1.bytesWritten;
							Me.dirPos = fileStartPos+write1.bytesWritten;
							//write1 is written and directory index is updated.
							later.emit('close');
						});
						//is later already finished?
						if (later.isEnded) {
							console.log("later already complete, copying data and sending");
							write1.write(later.waitingData);
							console.log("write1 going to end now");
							write1.end();
							
						} else {
							//later is not yet complete...
							console.log("stream later not yet complete");
							later.streamNow = write1;
							write1.write(later.waitingData);
							later.waitingData = undefined;
						}
					});
				});
				//create a dummy stream that is later on tied to the 
				//stream we get after truncating the file...
				return later;
			} else {
				//footer is not yet on disk, so we can just append.
				Me.footerModified=true;
				var write1 = fs.createWriteStream(Me.mountpath,{flags:'a'});
				write1.on('close',function(err) {
					//update the directory.
					console.log("append stream complete",fpath);
					var now = new Date().getTime();
					Me.dirs[fpath] = {
						size:write1.bytesWritten
						,start:fileStartPos
						,end:fileStartPos+write1.bytesWritten
						,name:path.basename(fpath)
						,atime:now
						,mtime:now
						,ctime:now
					}
					//update settings
					Me.msize = fileStartPos+write1.bytesWritten;
					Me.dirPos = fileStartPos+write1.bytesWritten;
				});
				return write1;
			}
		},rename:function(oldPath, newPath, renameDone) {
			if (!Me.dirs[oldPath]) {
				var err = new Error("ENOENT, rename '"+oldPath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = oldPath;
				renameDone(err);
			} else {
				var old = Me.dirs[oldPath];
				Me.dirs[newPath] = old;
				delete Me.dirs[oldPath];
			}
		},renameSync:function(oldPath, newPath, renameDone) {
			//we can support sync call since we complete immediately
			return Me.rename(oldPath,newPath,renameDone);
		},exists:function(fpath,existsDone) {
			if (Me.dirs[fpath]) {
				if (existsDone) existsDone(true);
			} else {
				if (existsDone) existsDone(false);
			}
		},existsSync:function(fpath) {
			if (Me.dirs[fpath]) {
				return true;
			} 
			return false;
		},chown(fpath,uid,gid,chownDone) {
			if (Me.dirs[fpath]) {
				
			}
		}
		
	}
	if (stats.size ==0) {
		//this is a new file.
		readyCall(Me);
	} else {
		Me._readFooter(readyCall);
	}
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
* and provide appfs object.
*/
module.exports.Mount = function(mountpath, readyCall) {
	fs.stat(mountpath,function(err,stats) {
		if (err && err.code == 'ENOENT') {
			//path does not exist...
			switch(path.extname(mountpath)) {
				case '.appfs':
					//create a new appfs.
					var write1 = fs.createWriteStream(mountpath,{flags:'w'});
					write1.end();
					write1.on('close',function() {
						var virtual = new appfs(mountpath,{size:0},readyCall);
					});
				break;
				default:
					throw "unknown format:"+mountpath;
				break;
			}
		} else {
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
						var virtual = new appfs(mountpath, stats,readyCall);
					break;
					default:
						throw "unknown format:"+mountpath;
					break;
				}
			}
		}
	});
}