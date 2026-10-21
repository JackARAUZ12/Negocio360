# Negocio360 Escritorio — envía bytes ESC/POS directo a una impresora de
# Windows en modo RAW (WinSpool), igual que la versión 1.0.1.
# El nombre de la impresora y el archivo llegan en variables de entorno
# (N360_IMPRESORA, N360_ARCHIVO): son datos, nunca código, así ningún
# nombre de impresora puede ejecutar nada.
$ErrorActionPreference = 'Stop'
$Impresora = $env:N360_IMPRESORA
$Archivo = $env:N360_ARCHIVO
if (-not $Impresora -or -not $Archivo) { Write-Output 'NEGOCIO360_ERROR:parametros'; exit }
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Negocio360RawPrint2 {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  // Devuelve 0 si todo salió bien; si no, el código de error de Windows.
  public static int Enviar(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero)) return Marshal.GetLastWin32Error();
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "Negocio360 - Ticket";
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return Marshal.GetLastWin32Error();
      try {
        if (!StartPagePrinter(h)) return Marshal.GetLastWin32Error();
        try {
          IntPtr p = Marshal.AllocCoTaskMem(datos.Length);
          try {
            Marshal.Copy(datos, 0, p, datos.Length);
            int escritos;
            if (!WritePrinter(h, p, datos.Length, out escritos)) return Marshal.GetLastWin32Error();
            if (escritos != datos.Length) return -2;
          } finally { Marshal.FreeCoTaskMem(p); }
        } finally { EndPagePrinter(h); }
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return 0;
  }
}
"@
  $datos = [System.IO.File]::ReadAllBytes($Archivo)
  $codigo = [Negocio360RawPrint2]::Enviar($Impresora, $datos)
  if ($codigo -eq 0) { Write-Output 'NEGOCIO360_OK' } else { Write-Output "NEGOCIO360_ERROR:$codigo" }
} catch {
  Write-Output 'NEGOCIO360_ERROR:script'
}
