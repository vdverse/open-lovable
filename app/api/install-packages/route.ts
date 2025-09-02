import { NextRequest, NextResponse } from 'next/server';

declare global {
  var activeSandbox: any;
  var sandboxData: any;
}

export async function POST(request: NextRequest) {
  try {
    const { packages, sandboxId } = await request.json();
    
    if (!packages || !Array.isArray(packages) || packages.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Packages array is required' 
      }, { status: 400 });
    }
    
    // Validate and deduplicate package names
    const validPackages = [...new Set(packages)]
      .filter(pkg => pkg && typeof pkg === 'string' && pkg.trim() !== '')
      .map(pkg => pkg.trim());
    
    if (validPackages.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No valid package names provided'
      }, { status: 400 });
    }
    
    // Log if duplicates were found
    if (packages.length !== validPackages.length) {
      console.log(`[install-packages] Cleaned packages: removed ${packages.length - validPackages.length} invalid/duplicate entries`);
      console.log(`[install-packages] Original:`, packages);
      console.log(`[install-packages] Cleaned:`, validPackages);
    }
    
    // Get active sandbox
    const sandbox = global.activeSandbox;
    
    if (!sandbox) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active sandbox available' 
      }, { status: 400 });
    }
    
    console.log('[install-packages] Installing packages:', validPackages);
    
    // Create a response stream for real-time updates
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    
    // Function to send progress updates
    const sendProgress = async (data: any) => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(message));
    };
    
    // Start installation in background
    (async (sandboxInstance) => {
      try {
        await sendProgress({ 
          type: 'start', 
          message: `Installing ${validPackages.length} package${validPackages.length > 1 ? 's' : ''}...`,
          packages: validPackages 
        });
        
        // Stop any existing development server first
        await sendProgress({ type: 'status', message: 'Stopping development server...' });
        
        try {
          // Try to kill any running dev server processes
          await sandboxInstance.runCommand({
            cmd: 'pkill',
            args: ['-f', 'vite']
          });
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait a bit
        } catch (error) {
          // It's OK if no process is found
          console.log('[install-packages] No existing dev server found');
        }
        
        // Check which packages are already installed
        await sendProgress({ 
          type: 'status', 
          message: 'Checking installed packages...' 
        });
        
        let packagesToInstall = validPackages;
        
        try {
          // Read package.json to check existing dependencies
          const catResult = await sandboxInstance.runCommand({
            cmd: 'cat',
            args: ['package.json']
          });
          if (catResult.exitCode === 0) {
            const packageJsonContent = await catResult.stdout();
            const packageJson = JSON.parse(packageJsonContent);
            
            const dependencies = packageJson.dependencies || {};
            const devDependencies = packageJson.devDependencies || {};
            const allDeps = { ...dependencies, ...devDependencies };
            
            const alreadyInstalled = [];
            const needInstall = [];
            
            for (const pkg of validPackages) {
              // Handle scoped packages
              const pkgName = pkg.startsWith('@') ? pkg : pkg.split('@')[0];
              
              if (allDeps[pkgName]) {
                alreadyInstalled.push(pkgName);
              } else {
                needInstall.push(pkg);
              }
            }
            
            packagesToInstall = needInstall;
            
            if (alreadyInstalled.length > 0) {
              await sendProgress({ 
                type: 'info', 
                message: `Already installed: ${alreadyInstalled.join(', ')}` 
              });
            }
          }
        } catch (error) {
          console.error('[install-packages] Error checking existing packages:', error);
          // If we can't check, just try to install all packages
          packagesToInstall = validPackages;
        }
        
        if (packagesToInstall.length === 0) {
          await sendProgress({ 
            type: 'success', 
            message: 'All packages are already installed',
            installedPackages: [],
            alreadyInstalled: validPackages
          });
          
          // Restart dev server
          await sendProgress({ type: 'status', message: 'Restarting development server...' });
          
          const devServerProcess = await sandboxInstance.runCommand({
            cmd: 'npm',
            args: ['run', 'dev'],
            detached: true
          });
          
          await sendProgress({ 
            type: 'complete', 
            message: 'Dev server restarted!',
            installedPackages: []
          });
          
          return;
        }
        
        // Install only packages that aren't already installed
        await sendProgress({ 
          type: 'info', 
          message: `Installing ${packagesToInstall.length} new package(s): ${packagesToInstall.join(', ')}`
        });
        
        // Run npm install
        const installArgs = ['install', '--legacy-peer-deps', ...packagesToInstall];
        const installResult = await sandboxInstance.runCommand({
          cmd: 'npm',
          args: installArgs
        });
        
        // Get install output
        const stdout = await installResult.stdout();
        const stderr = await installResult.stderr();
        
        if (stdout) {
          const lines = stdout.split('\n').filter(line => line.trim());
          for (const line of lines) {
            if (line.includes('npm WARN')) {
              await sendProgress({ type: 'warning', message: line });
            } else if (line.trim()) {
              await sendProgress({ type: 'output', message: line });
            }
          }
        }
        
        if (stderr) {
          const errorLines = stderr.split('\n').filter(line => line.trim());
          for (const line of errorLines) {
            if (line.includes('ERESOLVE')) {
              await sendProgress({ 
                type: 'warning', 
                message: `Dependency conflict resolved with --legacy-peer-deps: ${line}` 
              });
            } else if (line.trim()) {
              await sendProgress({ type: 'error', message: line });
            }
          }
        }
        
        if (installResult.exitCode === 0) {
          await sendProgress({ 
            type: 'success', 
            message: `Successfully installed: ${packagesToInstall.join(', ')}`,
            installedPackages: packagesToInstall
          });
        } else {
          await sendProgress({ 
            type: 'error', 
            message: 'Package installation failed' 
          });
        }
        
        // Restart development server
        await sendProgress({ type: 'status', message: 'Restarting development server...' });
        
        try {
          const devServerProcess = await sandboxInstance.runCommand({
            cmd: 'npm',
            args: ['run', 'dev'],
            detached: true
          });
          
          // Wait a bit for the server to start
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          await sendProgress({ 
            type: 'complete', 
            message: 'Package installation complete and dev server restarted!',
            installedPackages: packagesToInstall
          });
        } catch (error) {
          await sendProgress({ 
            type: 'error', 
            message: `Failed to restart dev server: ${(error as Error).message}` 
          });
        }
        
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (errorMessage && errorMessage !== 'undefined') {
          await sendProgress({ 
            type: 'error', 
            message: errorMessage
          });
        }
      } finally {
        await writer.close();
      }
    })(sandbox);
    
    // Return the stream
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
    
  } catch (error) {
    console.error('[install-packages] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: (error as Error).message 
    }, { status: 500 });
  }
}