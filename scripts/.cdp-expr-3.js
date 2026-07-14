(() => {
    const chunk = atob("TiB1cGRhdGVfcmF3X21hdGVyaWFsX3B1cmNoYXNlKAogIFVVSUQsIERBVEUsIE5VTUVSSUMsIE5VTUVSSUMsIFRFWFQsIFRFWFQsIFRFWFQKKSBUTyBzZXJ2aWNlX3JvbGU7CgpHUkFOVCBFWEVDVVRFIE9OIEZVTkNUSU9OIGFyY2hpdmVfcmF3X21hdGVyaWFsKFVVSUQpIFRPIGF1dGhlbnRpY2F0ZWQ7CkdSQU5UIEVYRUNVVEUgT04gRlVOQ1RJT04gYXJjaGl2ZV9yYXdfbWF0ZXJpYWwoVVVJRCkgVE8gc2VydmljZV9yb2xlOwoKR1JBTlQgRVhFQ1VURSBPTiBGVU5DVElPTiBhcmNoaXZlX2ZpbmlzaGVkX3Byb2R1Y3QoVVVJRCkgVE8gYXV0aGVudGljYXRlZDsKR1JBTlQgRVhFQ1VURSBPTiBGVU5DVElPTiBhcmNoaXZlX2ZpbmlzaGVkX3Byb2R1Y3QoVVVJRCkgVE8gc2VydmljZV9yb2xlOwoKQ09NTUlUOwoKTk9USUZZIHBncnN0LCAncmVsb2FkIHNjaGVtYSc7Cg==");
    const editors = window.monaco?.editor?.getEditors?.() || [];
    if (!editors.length) return "no editor";
    const model = editors[0].getModel();
    const current = model.getValue();
    const next = current + chunk;
    model.setValue(next);
    return "append " + next.length;
  })()