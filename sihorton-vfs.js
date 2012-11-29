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
		,isFragmented:false//disk file modified so needs to be compacted at some point.
		,formatName:'a'
		,formatSize:16
		,footerSize:(4*3)+16
		,dirPos:0
		,fileFormatv:0
		,flagv:0
		,dirs:{}
		,fds:[]
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
		,createReadStream:function(fpath,options) {
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
		},stat:function(fpath, statCalling) {
			if (Me.dirs[fpath]) {
				var stats = {
					isFile:function() {
						//@ToDo
						return undefined;
					},isDirectory:function() {
						//@ToDo
						return undefined;
					},isSymbolicLink:function() {
						if (this.link) {
							return true;
						} else {
							return false;
						}
					},isSocket:function() {return false;}
					,isFIFO:function() {return false;}
					,mode:Me.dirs[fpath].mode
					,uid:Me.dirs[fpath].uid
					,gid:Me.dirs[fpath].gid
					,size:Me.dirs[fpath].size
					,atime:Me.dirs[fpath].atime
					,mtime:Me.dirs[fpath].mtime
					,ctime:Me.dirs[fpath].ctime
				}
				statCalling(null,stats);
			} else {
				//simulate read error
				var err = new Error("ENOENT, stat '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				statCalling(err);
			}
		},rename:function(oldPath, newPath, renameDone) {
			if (!Me.dirs[oldPath]) {
				var err = new Error("ENOENT, rename '"+oldPath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = oldPath;
				renameDone(err);
			} else {
				if (Me.dirs[newPath]) {
					var err = new Error("path already exists, rename'"+newPath+"'");
					//err.errno = 34;
					//err.code = 'ENOENT';
					err.path = newPath;
					renameDone(err);
				} else {
					var old = Me.dirs[oldPath];
					Me.dirs[newPath] = old;
					delete Me.dirs[oldPath];
				}
			}
		},renameSync:function(oldPath, newPath, renameDone) {
			//we can support sync call since we complete immediately
			return Me.rename(oldPath,newPath,renameDone);
		},truncate:function(fd, len, done) {
			var fpath;
			if (typeof fd == 'string') {
				fpath = fd;
			} else {
				fpath = Me.fds[fd].path;
			}
			if (!Me.dirs[fpath]) {
				var err = new Error("ENOENT, truncate "+fd+" '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				done(err);
			} else {
				//uncontrolled altering of file size allowed here.
				Me.dirs[fpath].size = len;
				if (done) done();
			}
		},truncateSync:function(fd, len, done) {
			return Me.truncateSync(fd, len, done);
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
		},chown:function(fpath,uid,gid,chownDone) {
			if (Me.dirs[fpath]) {
				//is it a link?
				if (Me.dirs[fpath].link) {
					var l = Me.dirs[fpath].link;
					if (!Me.dirs[l]) {
						var err = new Error("ENOENT, chown lnk destination not found'"+fpath+"'");
						err.errno = 34;
						err.code = 'ENOENT';
						err.path = fpath;
						err.lnkpath = l;
						renameDone(err);					
					} else {
						Me.dirs[fpath].uid = uid;
						Me.dirs[fpath].gid = gid;
					}
				} else {
					Me.dirs[fpath].uid = uid;
					Me.dirs[fpath].gid = gid;
				}
				if (chownDone) chownDone();
			} else {
				var err = new Error("ENOENT, chown '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				renameDone(err);
			}
		},chownSync:function(fpath,uid,gid,chownDone) {
			//we can support sync call since we complete immediately
			return Me.chown(fpath,uid,gid,chownDone);
		},fchown:function(fd,uid,gid,chownDone) {
			fpath = Me.fds[fd].path;
			return Me.chown(fpath,uid,gid,chownDone);
		},fchownSync:function(fd,uid,gid,chownDone) {
			Me.fchown(fd,uid,gid,chownDone);		
		},lchown:function(fpath,uid,gid,chownDone) {
			if (!Me.dirs[fpath]) {
				var err = new Error("ENOENT, chown '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				chownDone(err);
			} else {
				Me.dirs[fpath].uid = uid;
				Me.dirs[fpath].gid = gid;
				if (chownDone) chownDone();
			}
		},lchownSync:function(fpath,uid,gid,chownDone) {
			Me.lchown(fpath,uid,gid,chownDone);		
		},chmod:function(fpath,mode,chmodDone) {
			//@ToDo: translate mode properly.
			if (Me.dirs[fpath]) {
				if (Me.dirs[fpath].link) {
					var l = Me.dirs[fpath].link;
					if (Me.dirs[l]) {
						Me.dirs[l].mode = mode;
					} else {
						var err = new Error("ENOENT, chmod lnk '"+fpath+"'");
						err.errno = 34;
						err.code = 'ENOENT';
						err.path = fpath;
						err.lnk = l;
						chownDone(err);
					}
				} else {
					Me.dirs[fpath].mode = mode;
				}
				if (chmodDone) chmodDone();
			} else {
				var err = new Error("ENOENT, chmod '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				renameDone(err);
			}
		},chmodSync:function(fpath,mode,done) {
			//we can support sync call since we complete immediately
			return Me.chmod(fpath,mode,done);
		},fchmod:function(fd,mode,chmodDone) {
			fpath = Me.fds[fd];
			Me.chmod(fpath,mod,chmodDone);
		},fchmodSync:function(fd,mode,chmodDone) {
			return Me.fchmod(fd,mode,chmodDone);
		},readlinkSync:function(fpath,done) {
			if (Me.dirs[fpath] && Me.dirs[fpath].link) {
				return Me.dirs[fpath].link;
			}
		},readlink:function(fpath,done) {
			if (Me.dirs[fpath] && Me.dirs[fpath].link) {
				done(null,Me.dirs[fpath].link);
			}
		},symlink:function(srcpath,dstpath,type,done) {
			//@ToDo: implement properly.
			Me.link(srcpath,dstpath,done);
		},link:function(srcpath,dstpath,done) {
			if (Me.dirs[dstpath]) {
				Me.dirs[srcpath] = {
					link:dstpath
					,uid:Me.dirs[dstpath].uid
					,gid:Me.dirs[dstpath].gid
					,mode:Me.dirs[dstpath].mode
				}
				if (done) done();
			} else {
				var err = new Error("ENOENT, link '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				renameDone(err);
			}
		},linkSync:function(srcpath,dstpath,done) {
			//we can support sync call since we complete immediately
			return Me.chmod(srcpath,dstpath,done);
		},unlink:function(fpath, done) {
			if (Me.dirs[fpath]) {
				delete Me.dirs[fpath];
				Me.isFragmented = true;
				if (done) done(null);
			} else {
				var err = new Error("ENOENT, link '"+fpath+"'");
				err.errno = 34;
				err.code = 'ENOENT';
				err.path = fpath;
				done(err);
			}
		},unlinkSync:function(fpath) {
			return unlink(fpath);
		}
		//,rmdir,rmdirSync,mkdir,mkdirSync
		//readdir,readdirSync
		,utimes:function(fpath,atime,mtime,done) {
			if (Me.dirs[fpath]) {
				Me.dirs[fpath].atime = atime;
				Me.dirs[fpath].mtime = mtime;
				if (done) done(null);
			}
		},utimesSync:function(fpath,atime,mtime) {
			utimes(fpath,atime,mtime);
		},futimes:function(fd,atime,mtime,done) {
			var fpath = Me.fds[fd];
			utimes(fpath,atime,mtime,done);
		},futimesSync:function(fd,atime,mtime) {
			var fpath = Me.fds[fd];
			utimes(fpath,atime,mtime);
		},fsync:function(fd,done) {
			//-- flush to disk
			if (done) done(null);
		},fsyncSync:function(fd) {
		}
		//poor initial implementation
		,open:function(fpath,flags,mode,done) {
			var fd = Me.fds.length;
			Me.fds.push({
				path:fpath
				,state:'open'
			});
			if (done) {
				done(null,fd);
			}
		},close:function(fd) {
			Me.fds[fd].state = 'closed';
		}/*,write(fd, buffer, offset, length, position, callback) {
			fpath = Me.fds[fd];
			var write1 = Me.createWriteStream(fpath,{start:offset,end:offset+length});
		}
		fs.writeSync(fd, buffer, offset, length, position)*/
		,read:function(fd, buffer, offset, length, position, callback) {
			fpath = Me.fds[fd];
			var read1 = Me.createReadStream(fpath,{start:offset,end:offset+length});
			var dat;
			read1.on('data',function(data) {
				if (typeof dat=='undefined') {
					dat = data;
				} else {
					dat += data;
				}
			});
			read1.on('close',function(data) {
				if (typeof dat=='undefined') {
					dat = data;
				} else {
					dat += data;
				}
				if (callback) {
					callback(null,length,dat);
				}
			});
		}
		//fs.readSync(fd, buffer, offset, length, position)
		
		,readFile:function(fpath, encoding, done) {
			var read1 = Me.createReadStream(fpath);
			var dat;
			read1.on('data',function(data) {
				if (typeof dat == 'undefined') {
					dat = data
				} else {
					dat += data;
				}
			});
			read1.on('end',function() {
				if (done) {
					done(null, dat);
				}
			});
		}
		//,readFileSync(filename, encoding)
		,writeFile:function(fpath, data, encoding, done) {
			var write1 = Me.createWriteStream(fpath);
			write1.on('close',function() {
				if (done) done(null);
			});
			write1.write(data);
			write1.end();
		}
		//writeFileSync(filename,data,encoding)
		//,appendFile(fpath,data,encoding,callback) {
			//this is a bad call in a vfs, since append is not going to be quick, basically we will have to create a new file at the end of the package every time you write!
		//,watch(fpath,options,listener) {
		
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