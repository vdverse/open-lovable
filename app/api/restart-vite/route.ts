import { NextResponse } from 'next/server';

declare global {
  var activeSandbox: any;
}

export async function POST() {
  try {
    if (!global.activeSandbox) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active sandbox' 
      }, { status: 400 });
    }
    
    console.log('[restart-vite] Forcing Vite restart...');
    
    // Kill existing Vite processes
    try {
      await global.activeSandbox.runCommand({
        cmd: 'pkill',
        args: ['-f', 'vite']
      });
      console.log('[restart-vite] Killed existing Vite processes');
      
      // Wait a moment for processes to terminate
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log('[restart-vite] No existing Vite processes found');
    }
    
    // Clear any error tracking files
    try {
      await global.activeSandbox.runCommand({
        cmd: 'bash',
        args: ['-c', 'echo \'{"errors": [], "lastChecked": '+ Date.now() +'}\' > /tmp/vite-errors.json']
      });
    } catch (error) {
      // Ignore if this fails
    }
    
    // Start Vite dev server in detached mode
    const viteProcess = await global.activeSandbox.runCommand({
      cmd: 'npm',
      args: ['run', 'dev'],
      detached: true
    });
    
    console.log('[restart-vite] Vite dev server restarted');
    
    // Wait for Vite to start up
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return NextResponse.json({
      success: true,
      message: 'Vite restarted successfully'
    });
    
  } catch (error) {
    console.error('[restart-vite] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: (error as Error).message 
    }, { status: 500 });
  }
}