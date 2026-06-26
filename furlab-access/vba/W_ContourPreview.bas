Attribute VB_Name = "W_ContourPreview"
Option Compare Database
Option Explicit

Public Function W_F2_OpenContour() As Boolean
    On Error GoTo ErrHandler
    Dim tagValue As String
    tagValue = Nz(Screen.ActiveForm!inventoryTag, "")
    If Len(tagValue) = 0 Then GoTo ExitFn

    DoCmd.OpenForm "Z_Debug_ContourJson", acNormal, , "inventoryTag='" & Replace(tagValue, "'", "''") & "'"
ExitFn:
    W_F2_OpenContour = True
    Exit Function
ErrHandler:
    MsgBox "Cannot open contour view: " & Err.Description, vbExclamation
    Resume ExitFn
End Function

Public Function W_F2_OpenContourPreview() As Boolean
    On Error GoTo ErrHandler
    MsgBox "F2_ContourPreview removed. Use preview on F2_ScrapPieceCard.", vbInformation, "Contour preview"
ExitFn:
    W_F2_OpenContourPreview = True
    Exit Function
ErrHandler:
    MsgBox "Cannot open contour preview: " & Err.Description, vbExclamation
    Resume ExitFn
End Function

Public Function W_F2_OpenContourVisual() As Boolean
    On Error GoTo ErrHandler
    If StrComp(Screen.ActiveForm.Name, "F2_ScrapPieceCard", vbTextCompare) = 0 Then
        W_F2_OpenContourVisual = W_F2_RenderContourVisual()
        Exit Function
    End If
    MsgBox "F2_ContourVisual removed. Use preview on F2_ScrapPieceCard.", vbInformation, "Contour visual"
ExitFn:
    W_F2_OpenContourVisual = True
    Exit Function
ErrHandler:
    MsgBox "Cannot open contour visual: " & Err.Description, vbExclamation
    Resume ExitFn
End Function

Public Function W_F2_ContourPreviewModeChanged() As Boolean
    On Error GoTo ExitFn
    Dim frm As Form
    Dim previewMode As String
    Dim isPieceMode As Boolean

    Set frm = Screen.ActiveForm
    previewMode = "Piece"
    On Error Resume Next
    previewMode = Nz(frm.Controls("cboPreviewMode").Value, "Piece")
    On Error GoTo ExitFn

    If StrComp(previewMode, "ScanA3", vbTextCompare) = 0 Then
        previewMode = "ScanA3"
    Else
        previewMode = "Piece"
    End If

    isPieceMode = (StrComp(previewMode, "Piece", vbTextCompare) = 0)
    On Error Resume Next
    frm.Controls("chkNormalizePiece").Enabled = isPieceMode
    frm.Controls("chkNormalizePiece").Visible = isPieceMode
    frm.Controls("lblNormalizePiece").Visible = isPieceMode
    If Not isPieceMode Then frm.Controls("chkNormalizePiece").Value = 0
    Err.Clear
    On Error GoTo ExitFn

ExitFn:
    W_F2_ContourPreviewModeChanged = True
End Function


Public Function W_F2_RenderContourPreview() As Boolean
    On Error GoTo ErrHandler
    Dim frm As Form
    Dim contourJson As String
    Dim napDeg As Double
    Dim previewText As String

    Set frm = Screen.ActiveForm
    contourJson = Nz(GetCurrentFieldText(frm, "scrapContour"), "")
    napDeg = CDbl(Nz(GetCurrentFieldText(frm, "napDirectionDeg"), 0))

    previewText = BuildContourAscii(contourJson, napDeg, 72, 28)
    SetControlValueIfExists frm, "txtContourAscii", previewText

ExitFn:
    W_F2_RenderContourPreview = True
    Exit Function

ErrHandler:
    SetControlValueIfExists frm, "txtContourAscii", "[render error] " & Err.Number & ": " & Err.Description
    Resume ExitFn
End Function

Private Sub SetControlValueIfExists(ByVal frm As Form, ByVal controlName As String, ByVal valueText As String)
    On Error Resume Next
    Dim ctl As Control
    Set ctl = frm.Controls(controlName)
    If Err.Number = 0 Then
        ctl.Value = valueText
    End If
    Err.Clear
    On Error GoTo 0
End Sub

Public Sub HideFormObject(ByVal formName As String)
    On Error Resume Next
    DoCmd.Close acForm, formName, acSaveYes
    Err.Clear
    On Error GoTo 0
End Sub

Public Function GetCurrentFieldText(ByVal frm As Form, ByVal fieldName As String) As String
    On Error GoTo ExitFn
    Dim rs As DAO.Recordset
    Dim v As Variant

    GetCurrentFieldText = ""
    If frm Is Nothing Then Exit Function
    If Len(Trim$(Nz(fieldName, ""))) = 0 Then Exit Function

    On Error Resume Next
    Set rs = frm.RecordsetClone
    If Err.Number <> 0 Then
        Err.Clear
        Set rs = Nothing
    End If
    On Error GoTo ExitFn

    If Not rs Is Nothing Then
        If rs.RecordCount <> 0 Then
            rs.Bookmark = frm.Bookmark
            On Error Resume Next
            v = rs.Fields(fieldName).Value
            If Err.Number = 0 Then
                If Not IsNull(v) Then GetCurrentFieldText = CStr(v)
                Err.Clear
                GoTo ExitFn
            End If
            Err.Clear
            On Error GoTo ExitFn
        End If
    End If

    On Error Resume Next
    v = frm.Controls(fieldName).Value
    If Err.Number = 0 Then
        If Not IsNull(v) Then GetCurrentFieldText = CStr(v)
        Err.Clear
    End If
    On Error GoTo ExitFn

ExitFn:
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    Set rs = Nothing
End Function

Private Function BuildContourAscii(ByVal contourJson As String, ByVal napDeg As Double, ByVal cols As Long, ByVal rows As Long) As String
    Dim xs() As Double
    Dim ys() As Double
    Dim n As Long
    Dim lines() As String
    Dim r As Long
    Dim i As Long
    Dim j As Long
    Dim minX As Double, maxX As Double, minY As Double, maxY As Double
    Dim rx As Double, ry As Double
    Dim c1 As Long, r1 As Long, c2 As Long, r2 As Long
    Dim cx As Double, cy As Double
    Dim tailC As Long, tailR As Long, headC As Long, headR As Long
    Dim arrLen As Double
    Dim rad As Double
    Dim arrowChar As String
    Dim out As String

    If cols < 20 Then cols = 20
    If rows < 10 Then rows = 10

    If Not ParseContourPoints(contourJson, xs, ys, n) Then
        BuildContourAscii = "[no contour points]"
        Exit Function
    End If

    minX = xs(0): maxX = xs(0)
    minY = ys(0): maxY = ys(0)
    For i = 1 To n - 1
        If xs(i) < minX Then minX = xs(i)
        If xs(i) > maxX Then maxX = xs(i)
        If ys(i) < minY Then minY = ys(i)
        If ys(i) > maxY Then maxY = ys(i)
    Next i

    rx = maxX - minX
    ry = maxY - minY
    If rx = 0# Then rx = 1#
    If ry = 0# Then ry = 1#

    ReDim lines(1 To rows)
    For r = 1 To rows
        lines(r) = String$(cols, " ")
    Next r

    For i = 0 To n - 1
        j = i + 1
        If j = n Then j = 0
        c1 = 2 + CLng((xs(i) - minX) / rx * (cols - 4))
        c2 = 2 + CLng((xs(j) - minX) / rx * (cols - 4))
        r1 = 2 + CLng((maxY - ys(i)) / ry * (rows - 4))
        r2 = 2 + CLng((maxY - ys(j)) / ry * (rows - 4))
        DrawAsciiLine lines, cols, rows, c1, r1, c2, r2, "#"
    Next i

    cx = 0#: cy = 0#
    For i = 0 To n - 1
        cx = cx + xs(i)
        cy = cy + ys(i)
    Next i
    cx = cx / n
    cy = cy / n

    tailC = 2 + CLng((cx - minX) / rx * (cols - 4))
    tailR = 2 + CLng((maxY - cy) / ry * (rows - 4))

    arrLen = IIf(cols < rows, cols, rows) / 5#
    rad = napDeg * 3.14159265358979 / 180#
    headC = tailC + CLng(arrLen * Cos(rad))
    headR = tailR - CLng(arrLen * Sin(rad))

    DrawAsciiLine lines, cols, rows, tailC, tailR, headC, headR, "."
    PlotChar lines, cols, rows, tailC, tailR, "o"

    If napDeg >= 45 And napDeg < 135 Then
        arrowChar = "^"
    ElseIf napDeg >= 135 And napDeg < 225 Then
        arrowChar = "<"
    ElseIf napDeg >= 225 And napDeg < 315 Then
        arrowChar = "v"
    Else
        arrowChar = ">"
    End If
    PlotChar lines, cols, rows, headC, headR, arrowChar

    out = "Contour preview (#=edge, o..>=nap)." & vbCrLf
    out = out & "napDirectionDeg=" & Format$(napDeg, "0.0") & vbCrLf
    For r = 1 To rows
        out = out & lines(r) & vbCrLf
    Next r
    BuildContourAscii = out
End Function

Public Function W_F2_RenderContourVisual() As Boolean
    W_F2_RenderContourVisual = W_F2_RenderContourVisualCore(True)
End Function

Public Function W_F2_RefreshPreviewOnly() As Boolean
    W_F2_RefreshPreviewOnly = W_F2_RenderContourVisualCore(False)
End Function

Private Function W_F2_RenderContourVisualCore(ByVal openInBrowser As Boolean) As Boolean
    On Error GoTo ErrHandler
    Dim frm As Form
    Dim contourJson As String
    Dim napDeg As Double
    Dim html As String
    Dim outPath As String
    Dim stage As String
    Dim previewMode As String
    Dim normalizePiece As Boolean
    Dim triggerName As String
    Dim tagValue As String
    Dim metricsJson As String

    Set frm = Screen.ActiveForm
    triggerName = ""
    On Error Resume Next
    triggerName = LCase$(Screen.ActiveControl.Name)
    On Error GoTo ErrHandler

    ' Safety guard: avoid auto-opening from incidental event handlers.
    If Len(triggerName) > 0 Then
        If triggerName <> "cmdrendervisual" And triggerName <> "cmdopenpreview" And triggerName <> "cmdrefreshpreview" Then
            SetPreviewOutput frm, "Ready. Click Open preview."
            W_F2_RenderContourVisualCore = True
            Exit Function
        End If
    End If

    stage = "read current row"
    contourJson = Nz(GetCurrentFieldText(frm, "scrapContour"), "")
    napDeg = CDbl(Nz(GetCurrentFieldText(frm, "napDirectionDeg"), 0))
    tagValue = Nz(GetCurrentFieldText(frm, "inventoryTag"), "")
    metricsJson = Nz(GetCurrentFieldText(frm, "metricsJson"), "")
    If Len(tagValue) = 0 Then tagValue = "unknown"

    previewMode = "Piece"
    normalizePiece = True

    On Error Resume Next
    previewMode = Nz(frm.Controls("cboPreviewMode").Value, "Piece")
    If Len(Trim$(previewMode)) = 0 Then previewMode = "Piece"
    normalizePiece = (Nz(frm.Controls("chkNormalizePiece").Value, True) <> 0)
    On Error GoTo ErrHandler

    If StrComp(previewMode, "ScanA3", vbTextCompare) <> 0 Then
        previewMode = "Piece"
    End If
    If StrComp(previewMode, "ScanA3", vbTextCompare) = 0 Then
        normalizePiece = False
    End If

    SetControlValueIfExists frm, "cboPreviewMode", previewMode
    SetControlValueIfExists frm, "chkNormalizePiece", IIf(normalizePiece, "-1", "0")
    W_F2_ContourPreviewModeChanged

    stage = "parse contour"
    If Len(contourJson) = 0 Then
        SetPreviewOutput frm, "No contour points."
        W_F2_RenderContourVisualCore = True
        Exit Function
    End If

    stage = "build svg"
    html = BuildContourSvgHtml(contourJson, napDeg, 980, 620, previewMode, normalizePiece)
    If Len(metricsJson) > 0 Then
        html = "<!-- metricsJson=" & Replace(metricsJson, "--", "__") & " -->" & vbCrLf & html
    End If

    stage = "render svg"
    stage = "save/open file"
    outPath = SaveHtmlToTempFile(html, "furlab_contour_preview", tagValue)
    If Len(outPath) > 0 Then
        If openInBrowser Then
            Application.FollowHyperlink outPath
            SetPreviewOutput frm, "Opened in browser. tag=" & tagValue & "; mode=" & previewMode & "; normalize=" & IIf(normalizePiece, "on", "off"), outPath
        Else
            SetPreviewOutput frm, "Preview refreshed. tag=" & tagValue & "; mode=" & previewMode & "; normalize=" & IIf(normalizePiece, "on", "off"), outPath
        End If
    Else
        SetPreviewOutput frm, "Failed to save temp html."
    End If
    W_F2_RenderContourVisualCore = True
    Exit Function

ErrHandler:
    SetPreviewOutput frm, "Render error " & Err.Number & " [" & stage & "]: " & Err.Description
    W_F2_RenderContourVisualCore = True
End Function

Private Sub SetPreviewOutput(ByVal frm As Form, ByVal statusText As String, Optional ByVal outPath As String = "")
    Dim fullText As String
    Dim debugVisible As Boolean
    fullText = statusText
    If Len(outPath) > 0 Then
        fullText = fullText & vbCrLf & outPath
    End If
    SetControlValueIfExists frm, "txtVisualOutput", fullText
    debugVisible = IsPreviewDebugEnabled() Or (InStr(1, LCase$(statusText), "render error", vbTextCompare) > 0)
    SetControlVisibleIfExists frm, "txtVisualOutput", debugVisible
    SetControlValueIfExists frm, "txtRenderStatus", statusText
    SetControlValueIfExists frm, "txtRenderPath", outPath
End Sub

Private Function IsPreviewDebugEnabled() As Boolean
    On Error GoTo ExitFn
    Dim v As Variant
    Dim s As String

    v = DLookup("cfgValue", "AppConfig", "cfgKey='ui.debug.preview'")
    s = LCase$(Trim$(Nz(v, "")))
    IsPreviewDebugEnabled = (s = "1" Or s = "true" Or s = "yes" Or s = "on")
    Exit Function
ExitFn:
    IsPreviewDebugEnabled = False
End Function

Private Sub SetControlVisibleIfExists(ByVal frm As Form, ByVal controlName As String, ByVal visibleValue As Boolean)
    On Error Resume Next
    frm.Controls(controlName).Visible = visibleValue
    Err.Clear
    On Error GoTo 0
End Sub

Private Function SaveHtmlToTempFile(ByVal html As String, ByVal prefixName As String, Optional ByVal inventoryTag As String = "") As String
    On Error GoTo Fail
    Dim p As String
    Dim stm As Object
    Dim safeTag As String
    safeTag = ToSafeFileNamePart(inventoryTag)
    If Len(safeTag) > 0 Then
        p = Environ$("TEMP") & "\" & prefixName & "_" & safeTag & "_" & Format$(Now, "yyyymmdd_hhnnss") & ".html"
    Else
        p = Environ$("TEMP") & "\" & prefixName & "_" & Format$(Now, "yyyymmdd_hhnnss") & ".html"
    End If
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2 ' adTypeText
    stm.Charset = "utf-8"
    stm.Open
    stm.WriteText html
    stm.SaveToFile p, 2 ' adSaveCreateOverWrite
    stm.Close
    Set stm = Nothing
    SaveHtmlToTempFile = p
    Exit Function
Fail:
    On Error Resume Next
    If Not stm Is Nothing Then
        stm.Close
        Set stm = Nothing
    End If
    SaveHtmlToTempFile = ""
End Function

Private Function ToSafeFileNamePart(ByVal rawText As String) As String
    Dim i As Long
    Dim ch As String
    Dim out As String
    Dim code As Integer

    For i = 1 To Len(rawText)
        ch = Mid$(rawText, i, 1)
        code = AscW(ch)
        If (code >= 48 And code <= 57) Or (code >= 65 And code <= 90) Or (code >= 97 And code <= 122) Or ch = "_" Or ch = "-" Then
            out = out & ch
        Else
            out = out & "_"
        End If
    Next i

    Do While InStr(out, "__") > 0
        out = Replace(out, "__", "_")
    Loop
    out = Trim$(out)
    If out = "_" Then out = ""
    ToSafeFileNamePart = out
End Function

Private Function BuildContourSvgHtml(ByVal contourJson As String, ByVal napDeg As Double, ByVal viewW As Long, ByVal viewH As Long, _
                                     Optional ByVal previewMode As String = "Piece", Optional ByVal normalizePiece As Boolean = True) As String
    Dim xs() As Double
    Dim ys() As Double
    Dim n As Long
    Dim i As Long
    Dim minX As Double, maxX As Double, minY As Double, maxY As Double
    Dim rx As Double, ry As Double
    Dim scaleK As Double
    Dim sx As Double, sy As Double
    Dim pts As String
    Dim svg As String
    Dim nDraw As Long
    Dim viewRotateDeg As Double
    Dim gridStepMm As Double
    Dim gx As Double, gy As Double
    Dim xLine As Double, yLine As Double
    Dim gridSvg As String
    Dim axisSvg As String
    Dim labelSvg As String
    Dim tickLen As Double
    Dim txtVal As String
    Dim infoSvg As String
    Dim legendScanArrow As String
    Dim legendNormArrow As String
    Dim legendNormText As String
    Dim infoX As Double, infoY As Double, infoW As Double
    Dim infoLineTop As Double, infoLineStep As Double
    Dim infoLines(0 To 8) As String
    Dim areaMm2 As Double
    Dim maxSpanMm As Double
    Dim rawMinX As Double, rawMaxX As Double, rawMinY As Double, rawMaxY As Double
    Dim rawRx As Double, rawRy As Double
    Dim rawRad As Double
    Dim normRad As Double
    Dim modeText As String
    Dim areaText As String
    Dim napText As String
    Dim rotateText As String
    Dim bboxViewText As String
    Dim bboxRawText As String
    Dim maxSpanText As String
    Dim cx As Double, cy As Double
    Dim cpx As Double, cpy As Double
    Dim inLenPx As Double
    Dim inRawHeadX As Double, inRawHeadY As Double
    Dim inNormHeadX As Double, inNormHeadY As Double
    Dim inArrowSvg As String
    Dim boxSvg As String
    Dim axisGuideSvg As String
    Dim ax0x As Double, ax0y As Double
    Dim plotX As Double, plotY As Double, plotW As Double, plotH As Double
    Dim panelX As Double, panelY As Double, panelW As Double, panelH As Double
    Dim panelGap As Double
    Dim pad As Double
    Dim padLeft As Double
    Dim padTop As Double
    Dim padBottom As Double
    Dim chartLeft As Double, chartTop As Double, chartRight As Double, chartBottom As Double

    If StrComp(previewMode, "ScanA3", vbTextCompare) = 0 Then
        BuildContourSvgHtml = BuildContourSvgHtmlScanA3(contourJson, napDeg, viewW, viewH)
        Exit Function
    End If

    If Not ParseContourPoints(contourJson, xs, ys, n) Then
        BuildContourSvgHtml = "<html><head><meta charset='utf-8' /></head><body style='font-family:Segoe UI'>No contour points.</body></html>"
        Exit Function
    End If

    nDraw = n
    If nDraw >= 2 Then
        If Abs(xs(0) - xs(nDraw - 1)) < 0.000001 And Abs(ys(0) - ys(nDraw - 1)) < 0.000001 Then nDraw = nDraw - 1
    End If
    If nDraw < 3 Then
        BuildContourSvgHtml = "<html><head><meta charset='utf-8' /></head><body style='font-family:Segoe UI'>No contour points.</body></html>"
        Exit Function
    End If

    RecomputeBounds xs, ys, nDraw, rawMinX, rawMaxX, rawMinY, rawMaxY
    rawRx = rawMaxX - rawMinX: If rawRx = 0# Then rawRx = 1#
    rawRy = rawMaxY - rawMinY: If rawRy = 0# Then rawRy = 1#

    viewRotateDeg = 0#
    If normalizePiece Then
        viewRotateDeg = ComputeViewRotateDeg(napDeg)
        RotatePointsClockwise xs, ys, nDraw, viewRotateDeg
    End If

    RecomputeBounds xs, ys, nDraw, minX, maxX, minY, maxY
    rx = maxX - minX: If rx = 0# Then rx = 1#
    ry = maxY - minY: If ry = 0# Then ry = 1#
    For i = 0 To nDraw - 1
        xs(i) = xs(i) - minX
        ys(i) = ys(i) - minY
    Next i

    SimplifyPolylineForPreview xs, ys, nDraw, 2#, 3#
    If nDraw < 3 Then
        BuildContourSvgHtml = "<html><head><meta charset='utf-8' /></head><body style='font-family:Segoe UI'>No contour points.</body></html>"
        Exit Function
    End If
    RecomputeBounds xs, ys, nDraw, minX, maxX, minY, maxY
    rx = maxX - minX: If rx = 0# Then rx = 1#
    ry = maxY - minY: If ry = 0# Then ry = 1#

    panelGap = 18#
    panelW = 312#
    plotX = 12#: plotY = 12#
    plotH = viewH - 24#
    If viewW < 760 Then panelW = 250#
    plotW = viewW - plotX - panelGap - panelW - 12#
    If plotW < 380# Then
        panelW = 220#
        plotW = viewW - plotX - panelGap - panelW - 12#
    End If
    If plotW < 260# Then plotW = 260#
    panelX = plotX + plotW + panelGap
    panelY = plotY
    panelH = plotH

    padLeft = 44#
    padTop = 26#
    scaleK = (plotW - padLeft - padTop) / rx
    If ((plotH - 2# * padTop) / ry) < scaleK Then scaleK = (plotH - 2# * padTop) / ry
    If scaleK <= 0# Then scaleK = 1#
    chartLeft = plotX + padLeft
    chartTop = plotY + padTop
    chartRight = chartLeft + rx * scaleK
    chartBottom = chartTop + ry * scaleK

    gridStepMm = 20#
    gridSvg = ""
    axisSvg = ""
    labelSvg = ""
    tickLen = 6#

    gx = 0#
    ' Piece axis policy: keep one step free near axis titles to avoid overlap.
    Do While gx <= rx + 0.001
        xLine = chartLeft + gx * scaleK
        gridSvg = gridSvg & "<line class='t-grid-minor' x1='" & SvgNum(xLine) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(xLine) & "' y2='" & SvgNum(chartBottom) & "' stroke='#e1e5ea' stroke-width='0.8'/>"
        gx = gx + gridStepMm
    Loop
    gy = 0#
    Do While gy <= ry + 0.001
        yLine = chartTop + gy * scaleK
        gridSvg = gridSvg & "<line class='t-grid-minor' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(yLine) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(yLine) & "' stroke='#e1e5ea' stroke-width='0.8'/>"
        gy = gy + gridStepMm
    Loop

    axisSvg = axisSvg & "<line class='t-axis' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(chartTop) & "' stroke='#1f2328' stroke-width='1.25'/>"
    axisSvg = axisSvg & "<line class='t-axis' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(chartLeft) & "' y2='" & SvgNum(chartBottom) & "' stroke='#1f2328' stroke-width='1.25'/>"

    gx = 0#
    Do While gx <= rx + 0.001
        xLine = chartLeft + gx * scaleK
        If gx < rx - (gridStepMm + 0.001) Then
            axisSvg = axisSvg & "<line class='t-axis-tick' x1='" & SvgNum(xLine) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(xLine) & "' y2='" & SvgNum(chartTop - tickLen) & "' stroke='#1f2328' stroke-width='0.9'/>"
        End If
        If gx > 0.001 And gx < rx - (gridStepMm + 0.001) Then
            txtVal = SvgNum(gx)
            labelSvg = labelSvg & "<text class='t-axis-text' x='" & SvgNum(xLine) & "' y='" & SvgNum(chartTop - 10) & "' text-anchor='middle' fill='#1f2328' font-size='10'>" & txtVal & "</text>"
        End If
        gx = gx + gridStepMm
    Loop
    gy = 0#
    Do While gy <= ry + 0.001
        yLine = chartTop + gy * scaleK
        If gy < ry - (gridStepMm + 0.001) Then
            axisSvg = axisSvg & "<line class='t-axis-tick' x1='" & SvgNum(chartLeft - tickLen) & "' y1='" & SvgNum(yLine) & "' x2='" & SvgNum(chartLeft) & "' y2='" & SvgNum(yLine) & "' stroke='#1f2328' stroke-width='0.9'/>"
        End If
        If gy > 0.001 And gy < ry - (gridStepMm + 0.001) Then
            txtVal = SvgNum(gy)
            labelSvg = labelSvg & "<text class='t-axis-text' x='" & SvgNum(chartLeft - 10) & "' y='" & SvgNum(yLine + 3) & "' text-anchor='end' fill='#1f2328' font-size='10'>" & txtVal & "</text>"
        End If
        gy = gy + gridStepMm
    Loop
    labelSvg = labelSvg & "<text class='t-axis-text' x='" & SvgNum(chartLeft - 12) & "' y='" & SvgNum(chartTop - 2) & "' fill='#1f2328' font-size='10'>0</text>" & _
                        "<text class='t-axis-text' x='" & SvgNum(chartRight) & "' y='" & SvgNum(chartTop - 10) & "' text-anchor='end' fill='#1f2328' font-size='10'>" & SvgText("X, mm") & "</text>" & _
                        "<text class='t-axis-text' x='" & SvgNum(chartLeft - 10) & "' y='" & SvgNum(chartBottom) & "' text-anchor='end' fill='#1f2328' font-size='10'>" & SvgText("Y, mm") & "</text>"

    pts = ""
    For i = 0 To nDraw - 1
        sx = chartLeft + xs(i) * scaleK
        sy = chartTop + ys(i) * scaleK
        If i > 0 Then pts = pts & " "
        pts = pts & SvgNum(sx) & " " & SvgNum(sy)
    Next i

    rawRad = napDeg * 3.14159265358979 / 180#
    normRad = 90# * 3.14159265358979 / 180#
    ComputePolygonCentroid xs, ys, nDraw, cx, cy
    cpx = chartLeft + cx * scaleK
    cpy = chartTop + cy * scaleK
    inLenPx = (IIf(rx < ry, rx, ry) * scaleK) * 0.22
    If inLenPx < 28# Then inLenPx = 28#

    inRawHeadX = cpx + Cos(rawRad) * inLenPx
    inRawHeadY = cpy + Sin(rawRad) * inLenPx
    inNormHeadX = cpx + Cos(normRad) * inLenPx
    inNormHeadY = cpy + Sin(normRad) * inLenPx

    inArrowSvg = ArrowSvgClass(cpx, cpy, inRawHeadX, inRawHeadY, "arrow-scan", "arrow-scan-dot")
    If normalizePiece Then
        inArrowSvg = inArrowSvg & ArrowSvgClass(cpx, cpy, inNormHeadX, inNormHeadY, "arrow-norm", "arrow-norm-dot")
    End If

    areaMm2 = PolygonAreaFromArrays(xs, ys, nDraw)
    maxSpanMm = PolygonMaxSpanFromArrays(xs, ys, nDraw)
    If normalizePiece Then
        modeText = "Mode: Piece (normalized view)"
    Else
        modeText = "Mode: Piece (raw view)"
    End If
    napText = Replace(Format$(napDeg, "0.0"), ",", ".")
    rotateText = Replace(Format$(viewRotateDeg, "0.0"), ",", ".")
    bboxViewText = Replace(Format$(rx, "0.0"), ",", ".") & " x " & Replace(Format$(ry, "0.0"), ",", ".")
    bboxRawText = Replace(Format$(rawRx, "0.0"), ",", ".") & " x " & Replace(Format$(rawRy, "0.0"), ",", ".")
    maxSpanText = Replace(Format$(maxSpanMm, "0.0"), ",", ".")
    areaText = Replace(Format$(Round(areaMm2, 0), "#,##0"), ",", " ")
    areaText = Replace(areaText, ChrW(&HA0), " ")

    infoLines(0) = modeText
    infoLines(1) = "Bounds (view): " & bboxViewText & " mm"
    infoLines(2) = "Bounds (raw): " & bboxRawText & " mm"
    infoLines(3) = "Area: " & areaText & " mm^2"
    infoLines(4) = "Max span: " & maxSpanText & " mm"
    infoLines(5) = "Nap angle (scan): " & napText & " deg"
    infoLines(6) = "Reference: from axis X, clockwise"
    infoLines(7) = "View rotation: " & rotateText & " deg"
    infoLines(8) = "Contour points: " & CStr(nDraw)

    infoX = panelX + 12#
    infoY = panelY + 42#
    infoW = panelW - 24#
    infoLineTop = 0#
    infoLineStep = 20#
    legendScanArrow = ArrowSvgClass(infoX + 12#, panelY + panelH - 42#, infoX + 54#, panelY + panelH - 42#, "arrow-scan", "arrow-scan-dot")
    legendNormArrow = ""
    legendNormText = ""
    If normalizePiece Then
        legendNormArrow = ArrowSvgClass(infoX + 12#, panelY + panelH - 20#, infoX + 54#, panelY + panelH - 20#, "arrow-norm", "arrow-norm-dot")
        legendNormText = "<text class='t-legend-text' x='" & SvgNum(infoX + 66#) & "' y='" & SvgNum(panelY + panelH - 16#) & "' fill='#1f2328' font-size='10' font-family='Consolas, Courier New, monospace'>normalized (down)</text>"
    End If
    infoSvg = "<rect class='t-panel' x='" & SvgNum(panelX) & "' y='" & SvgNum(panelY) & "' width='" & SvgNum(panelW) & "' height='" & SvgNum(panelH) & "' fill='#fdfdfd' stroke='#2b3138' stroke-width='1'/>" & _
              "<text class='t-panel-title' x='" & SvgNum(infoX) & "' y='" & SvgNum(panelY + 22#) & "' fill='#1f2328' font-size='12' font-family='Consolas, Courier New, monospace'>Contour Summary</text>" & _
              "<line class='t-panel-rule' x1='" & SvgNum(infoX) & "' y1='" & SvgNum(panelY + 28#) & "' x2='" & SvgNum(infoX + infoW) & "' y2='" & SvgNum(panelY + 28#) & "' stroke='#c8ccd2' stroke-width='1'/>" & _
              "<g class='t-panel-text' fill='#1f2328' font-size='11' font-family='Consolas, Courier New, monospace'>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 0#) & "'>" & SvgText(infoLines(0)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 1#) & "'>" & SvgText(infoLines(1)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 2#) & "'>" & SvgText(infoLines(2)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 3#) & "'>" & SvgText(infoLines(3)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 4#) & "'>" & SvgText(infoLines(4)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 5#) & "'>" & SvgText(infoLines(5)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 6#) & "'>" & SvgText(infoLines(6)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 7#) & "'>" & SvgText(infoLines(7)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + infoLineTop + infoLineStep * 8#) & "'>" & SvgText(infoLines(8)) & "</text>" & _
              "</g>" & _
              "<line class='t-panel-rule' x1='" & SvgNum(infoX) & "' y1='" & SvgNum(panelY + panelH - 64#) & "' x2='" & SvgNum(infoX + infoW) & "' y2='" & SvgNum(panelY + panelH - 64#) & "' stroke='#c8ccd2' stroke-width='1'/>" & _
              legendScanArrow & _
              "<text class='t-legend-text' x='" & SvgNum(infoX + 66#) & "' y='" & SvgNum(panelY + panelH - 38#) & "' fill='#1f2328' font-size='10' font-family='Consolas, Courier New, monospace'>scan direction</text>" & _
              legendNormArrow & legendNormText

    boxSvg = "<line class='t-box-line' x1='" & SvgNum(chartRight) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(chartBottom) & "' stroke='#d3d9e1' stroke-width='0.85'/>" & _
             "<line class='t-box-line' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(chartBottom) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(chartBottom) & "' stroke='#d3d9e1' stroke-width='0.85'/>"
    axisGuideSvg = ""

    svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " & CStr(viewW) & " " & CStr(viewH) & "' width='100%' height='100%' preserveAspectRatio='xMidYMid meet'>" & _
          "<rect x='0' y='0' width='" & CStr(viewW) & "' height='" & CStr(viewH) & "' fill='#f1f3f6' stroke='#c9ced6'/>" & _
          "<rect x='" & SvgNum(plotX) & "' y='" & SvgNum(plotY) & "' width='" & SvgNum(plotW) & "' height='" & SvgNum(plotH) & "' fill='#ffffff' stroke='#c2c8d0' stroke-width='1'/>" & _
          gridSvg & axisSvg & labelSvg & boxSvg & _
          "<polygon class='t-contour' points='" & pts & "' fill='none' stroke='#1f2328' stroke-width='2'/>" & _
          inArrowSvg & _
          infoSvg & _
          "</svg>"
    svg = ApplyTemplate("contour_piece_svg.xml", svg, "{{VIEW_W}}", CStr(viewW), "{{VIEW_H}}", CStr(viewH))
    svg = Replace(svg, "{{PLOT_X}}", SvgNum(plotX))
    svg = Replace(svg, "{{PLOT_Y}}", SvgNum(plotY))
    svg = Replace(svg, "{{PLOT_W}}", SvgNum(plotW))
    svg = Replace(svg, "{{PLOT_H}}", SvgNum(plotH))
    svg = Replace(svg, "{{LAYERS}}", gridSvg & axisSvg & labelSvg & boxSvg)
    svg = Replace(svg, "{{PTS}}", pts)
    svg = Replace(svg, "{{IN_ARROW}}", inArrowSvg)
    svg = Replace(svg, "{{PANEL_X}}", SvgNum(panelX))
    svg = Replace(svg, "{{PANEL_Y}}", SvgNum(panelY))
    svg = Replace(svg, "{{PANEL_W}}", SvgNum(panelW))
    svg = Replace(svg, "{{PANEL_H}}", SvgNum(panelH))
    svg = Replace(svg, "{{INFO_X}}", SvgNum(infoX))
    svg = Replace(svg, "{{INFO_X2}}", SvgNum(infoX + infoW))
    svg = Replace(svg, "{{TITLE_Y}}", SvgNum(panelY + 22#))
    svg = Replace(svg, "{{TITLE_RULE_Y}}", SvgNum(panelY + 28#))
    svg = Replace(svg, "{{INFO_Y0}}", SvgNum(infoY + infoLineTop + infoLineStep * 0#))
    svg = Replace(svg, "{{INFO_Y1}}", SvgNum(infoY + infoLineTop + infoLineStep * 1#))
    svg = Replace(svg, "{{INFO_Y2}}", SvgNum(infoY + infoLineTop + infoLineStep * 2#))
    svg = Replace(svg, "{{INFO_Y3}}", SvgNum(infoY + infoLineTop + infoLineStep * 3#))
    svg = Replace(svg, "{{INFO_Y4}}", SvgNum(infoY + infoLineTop + infoLineStep * 4#))
    svg = Replace(svg, "{{INFO_Y5}}", SvgNum(infoY + infoLineTop + infoLineStep * 5#))
    svg = Replace(svg, "{{INFO_Y6}}", SvgNum(infoY + infoLineTop + infoLineStep * 6#))
    svg = Replace(svg, "{{INFO_Y7}}", SvgNum(infoY + infoLineTop + infoLineStep * 7#))
    svg = Replace(svg, "{{INFO_Y8}}", SvgNum(infoY + infoLineTop + infoLineStep * 8#))
    svg = Replace(svg, "{{INFO_LINE_0}}", SvgText(infoLines(0)))
    svg = Replace(svg, "{{INFO_LINE_1}}", SvgText(infoLines(1)))
    svg = Replace(svg, "{{INFO_LINE_2}}", SvgText(infoLines(2)))
    svg = Replace(svg, "{{INFO_LINE_3}}", SvgText(infoLines(3)))
    svg = Replace(svg, "{{INFO_LINE_4}}", SvgText(infoLines(4)))
    svg = Replace(svg, "{{INFO_LINE_5}}", SvgText(infoLines(5)))
    svg = Replace(svg, "{{INFO_LINE_6}}", SvgText(infoLines(6)))
    svg = Replace(svg, "{{INFO_LINE_7}}", SvgText(infoLines(7)))
    svg = Replace(svg, "{{INFO_LINE_8}}", SvgText(infoLines(8)))
    svg = Replace(svg, "{{LEGEND_RULE_Y}}", SvgNum(panelY + panelH - 64#))
    svg = Replace(svg, "{{LEGEND_SCAN_ARROW}}", legendScanArrow)
    svg = Replace(svg, "{{LEGEND_TX}}", SvgNum(infoX + 66#))
    svg = Replace(svg, "{{LEGEND_SCAN_TY}}", SvgNum(panelY + panelH - 38#))
    svg = Replace(svg, "{{LEGEND_NORM_ARROW}}", legendNormArrow)
    svg = Replace(svg, "{{LEGEND_NORM_TEXT}}", legendNormText)

    BuildContourSvgHtml = WrapSvgInHtmlTemplate(svg, "#f1f3f6")
End Function

Private Function BuildContourSvgHtmlScanA3(ByVal contourJson As String, ByVal napDeg As Double, ByVal viewW As Long, ByVal viewH As Long) As String
    Dim xs() As Double
    Dim ys() As Double
    Dim n As Long
    Dim nDraw As Long
    Dim i As Long
    Dim pad As Double
    Dim scaleK As Double
    Dim sx As Double, sy As Double
    Dim pts As String
    Dim gridSvgMinor As String
    Dim gridSvgMajor As String
    Dim edgeLabels As String
    Dim headerSvg As String
    Dim gx As Double, gy As Double
    Dim xLine As Double, yLine As Double
    Dim areaMm2 As Double
    Dim minX As Double, maxX As Double, minY As Double, maxY As Double
    Dim bboxW As Double, bboxH As Double
    Dim infoSvg As String
    Dim infoX As Double, infoY As Double, infoW As Double, infoH As Double
    Dim infoLines(0 To 4) As String
    Dim cx As Double, cy As Double
    Dim tailX As Double, tailY As Double, headX As Double, headY As Double
    Dim rawRad As Double
    Dim arrLenPx As Double
    Dim arrLenMm As Double
    Dim axisGuideSvg As String
    Dim svg As String
    Dim fitMargin As Double
    Dim fitScale As Double
    Dim tx As Double
    Dim ty As Double
    Dim padLeft As Double
    Dim padTop As Double
    Dim padBottom As Double
    Dim panelGap As Double
    Dim panelW2 As Double
    Dim plotX As Double, plotY As Double, plotW As Double, plotH As Double
    Dim panelX As Double, panelY As Double, panelH As Double
    Dim chartLeft As Double, chartTop As Double, chartRight As Double, chartBottom As Double
    Const A3W As Double = 420#
    Const A3H As Double = 297#

    If Not ParseContourPoints(contourJson, xs, ys, n) Then
        BuildContourSvgHtmlScanA3 = "<html><head><meta charset='utf-8' /></head><body style='font-family:Segoe UI'>No contour points.</body></html>"
        Exit Function
    End If

    nDraw = n
    If nDraw >= 2 Then
        If Abs(xs(0) - xs(nDraw - 1)) < 0.000001 And Abs(ys(0) - ys(nDraw - 1)) < 0.000001 Then
            nDraw = nDraw - 1
        End If
    End If
    If nDraw < 3 Then
        BuildContourSvgHtmlScanA3 = "<html><head><meta charset='utf-8' /></head><body style='font-family:Segoe UI'>No contour points.</body></html>"
        Exit Function
    End If

    RecomputeBounds xs, ys, nDraw, minX, maxX, minY, maxY
    bboxW = maxX - minX
    bboxH = maxY - minY
    areaMm2 = PolygonAreaFromArrays(xs, ys, nDraw)

    fitMargin = 6#
    fitScale = 1#
    If bboxW > (A3W - 2# * fitMargin) Or bboxH > (A3H - 2# * fitMargin) Then
        fitScale = (A3W - 2# * fitMargin) / IIf(bboxW > 0#, bboxW, 1#)
        If ((A3H - 2# * fitMargin) / IIf(bboxH > 0#, bboxH, 1#)) < fitScale Then
            fitScale = (A3H - 2# * fitMargin) / IIf(bboxH > 0#, bboxH, 1#)
        End If
    End If
    If fitScale <= 0# Then fitScale = 1#

    For i = 0 To nDraw - 1
        xs(i) = (xs(i) - minX) * fitScale
        ys(i) = (ys(i) - minY) * fitScale
    Next i
    bboxW = bboxW * fitScale
    bboxH = bboxH * fitScale

    tx = fitMargin + (A3W - 2# * fitMargin - bboxW) / 2#
    ty = fitMargin + (A3H - 2# * fitMargin - bboxH) / 2#
    For i = 0 To nDraw - 1
        xs(i) = xs(i) + tx
        ys(i) = ys(i) + ty
    Next i

    ' Light preview-only cleanup to reduce visual spikes.
    SimplifyPolylineForPreview xs, ys, nDraw, 1.2, 2.5

    panelGap = 18#
    panelW2 = 312#
    plotX = 12#: plotY = 12#
    plotH = viewH - 24#
    If viewW < 760 Then panelW2 = 250#
    If panelW2 > (viewW * 0.42) Then panelW2 = viewW * 0.42
    plotW = viewW - plotX - panelGap - panelW2 - 12#
    If plotW < 380# Then
        panelW2 = 220#
        If panelW2 > (viewW * 0.42) Then panelW2 = viewW * 0.42
        plotW = viewW - plotX - panelGap - panelW2 - 12#
    End If
    If plotW < 260# Then
        plotW = 260#
        panelW2 = viewW - plotX - panelGap - plotW - 12#
        If panelW2 < 180# Then
            panelW2 = 180#
            plotW = viewW - plotX - panelGap - panelW2 - 12#
            If plotW < 220# Then plotW = 220#
        End If
    End If
    panelX = plotX + plotW + panelGap
    panelY = plotY
    panelH = plotH

    padTop = 28#
    padBottom = 40#
    padLeft = 44#
    scaleK = (plotW - padLeft - padTop) / A3W
    If ((plotH - padTop - padBottom) / A3H) < scaleK Then scaleK = (plotH - padTop - padBottom) / A3H
    If scaleK <= 0# Then scaleK = 1#

    chartLeft = plotX + padLeft
    chartTop = plotY + padTop
    chartRight = chartLeft + A3W * scaleK
    chartBottom = chartTop + A3H * scaleK

    gridSvgMinor = ""
    gridSvgMajor = ""
    edgeLabels = ""
    gx = 0#
    ' A3 axis policy: 50 mm labels, suppress end labels near axis captions.
    Do While gx <= A3W + 0.001
        xLine = chartLeft + gx * scaleK
        If (CLng(gx) Mod 50) = 0 Then
            gridSvgMajor = gridSvgMajor & "<line class='t-grid-major' x1='" & SvgNum(xLine) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(xLine) & "' y2='" & SvgNum(chartBottom) & "' stroke='#d3d9e1' stroke-width='0.9'/>"
            If gx > 0.001 And gx < A3W - (50# + 0.001) Then
                edgeLabels = edgeLabels & "<text class='t-axis-text' x='" & SvgNum(xLine) & "' y='" & SvgNum(chartTop - 8#) & "' text-anchor='middle' fill='#666666' font-size='10'>" & SvgNum(gx) & "</text>"
            End If
        Else
            gridSvgMinor = gridSvgMinor & "<line class='t-grid-minor' x1='" & SvgNum(xLine) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(xLine) & "' y2='" & SvgNum(chartBottom) & "' stroke='#e8ecf1' stroke-width='0.6'/>"
        End If
        gx = gx + 10#
    Loop

    gy = 0#
    Do While gy <= A3H + 0.001
        yLine = chartTop + gy * scaleK
        If (CLng(gy) Mod 50) = 0 Then
            gridSvgMajor = gridSvgMajor & "<line class='t-grid-major' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(yLine) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(yLine) & "' stroke='#d3d9e1' stroke-width='0.9'/>"
            If CLng(gy) <> 0 And gy < A3H - 0.001 Then
                edgeLabels = edgeLabels & "<text class='t-axis-text' x='" & SvgNum(chartLeft - 10#) & "' y='" & SvgNum(yLine + 3#) & "' text-anchor='end' fill='#666666' font-size='10'>" & SvgNum(gy) & "</text>"
            End If
        Else
            gridSvgMinor = gridSvgMinor & "<line class='t-grid-minor' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(yLine) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(yLine) & "' stroke='#e8ecf1' stroke-width='0.6'/>"
        End If
        gy = gy + 10#
    Loop
    edgeLabels = edgeLabels & "<text class='t-axis-text' x='" & SvgNum(chartLeft - 12#) & "' y='" & SvgNum(chartTop - 2#) & "' fill='#666666' font-size='10'>0</text>" & _
                             "<text class='t-axis-text' x='" & SvgNum(chartRight) & "' y='" & SvgNum(chartTop - 10#) & "' text-anchor='end' fill='#666666' font-size='10'>" & SvgText("X, mm") & "</text>" & _
                             "<text class='t-axis-text' x='" & SvgNum(chartLeft - 10#) & "' y='" & SvgNum(chartBottom) & "' text-anchor='end' fill='#666666' font-size='10'>" & SvgText("Y, mm") & "</text>"

    pts = ""
    For i = 0 To nDraw - 1
        sx = chartLeft + xs(i) * scaleK
        sy = chartTop + ys(i) * scaleK
        If i > 0 Then pts = pts & " "
        pts = pts & SvgNum(sx) & " " & SvgNum(sy)
    Next i

    ComputePolygonCentroid xs, ys, nDraw, cx, cy
    tailX = chartLeft + cx * scaleK
    tailY = chartTop + cy * scaleK
    rawRad = napDeg * 3.14159265358979 / 180#
    arrLenMm = 60#
    arrLenPx = arrLenMm * scaleK
    If arrLenPx < 32# Then arrLenPx = 32#
    headX = tailX + Cos(rawRad) * arrLenPx
    headY = tailY + Sin(rawRad) * arrLenPx

    infoLines(0) = "Mode: Scan A3 (420 x 297 mm)"
    infoLines(1) = "Area: " & Replace(Format$(areaMm2, "0"), ",", ".") & " mm^2"
    infoLines(2) = "Bounds: " & Replace(Format$(bboxW, "0.0"), ",", ".") & " x " & Replace(Format$(bboxH, "0.0"), ",", ".") & " mm"
    infoLines(3) = "Anchor points: " & CStr(nDraw)
    infoLines(4) = "Nap: " & Replace(Format$(napDeg, "0.0"), ",", ".") & " deg (from axis X, clockwise)"

    infoX = panelX + 12#
    infoY = panelY + 42#
    infoW = panelW2 - 24#
    infoH = panelH
    infoSvg = "<rect class='t-panel' x='" & SvgNum(panelX) & "' y='" & SvgNum(panelY) & "' width='" & SvgNum(panelW2) & "' height='" & SvgNum(panelH) & "' fill='#fdfdfd' stroke='#2b3138' stroke-width='1'/>" & _
              "<text class='t-panel-title' x='" & SvgNum(infoX) & "' y='" & SvgNum(panelY + 22#) & "' fill='#1f2328' font-size='12' font-family='Consolas, Courier New, monospace'>Contour Summary</text>" & _
              "<line class='t-panel-rule' x1='" & SvgNum(infoX) & "' y1='" & SvgNum(panelY + 28#) & "' x2='" & SvgNum(infoX + infoW) & "' y2='" & SvgNum(panelY + 28#) & "' stroke='#c8ccd2' stroke-width='1'/>" & _
              "<g class='t-panel-text' fill='#1f2328' font-size='11' font-family='Consolas, Courier New, monospace'>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + 0#) & "'>" & SvgText(infoLines(0)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + 20#) & "'>" & SvgText(infoLines(1)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + 40#) & "'>" & SvgText(infoLines(2)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + 60#) & "'>" & SvgText(infoLines(3)) & "</text>" & _
              "<text x='" & SvgNum(infoX) & "' y='" & SvgNum(infoY + 80#) & "'>" & SvgText(infoLines(4)) & "</text>" & _
              "</g>"

    svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " & CStr(viewW) & " " & CStr(viewH) & "' width='100%' height='100%' preserveAspectRatio='xMidYMid meet'>" & _
          "<rect x='0' y='0' width='" & CStr(viewW) & "' height='" & CStr(viewH) & "' fill='#f1f3f6' stroke='#c9ced6'/>" & _
          "<rect x='" & SvgNum(plotX) & "' y='" & SvgNum(plotY) & "' width='" & SvgNum(plotW) & "' height='" & SvgNum(plotH) & "' fill='#ffffff' stroke='#c2c8d0' stroke-width='1'/>" & _
          gridSvgMinor & gridSvgMajor & edgeLabels & _
          "<line class='t-axis-main' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(chartTop) & "' stroke='#1f2328' stroke-width='1.25'/>" & _
          "<line class='t-axis-main' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(chartLeft) & "' y2='" & SvgNum(chartBottom) & "' stroke='#1f2328' stroke-width='1.25'/>" & _
          "<line class='t-box-line' x1='" & SvgNum(chartRight) & "' y1='" & SvgNum(chartTop) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(chartBottom) & "' stroke='#d3d9e1' stroke-width='0.9'/>" & _
          "<line class='t-box-line' x1='" & SvgNum(chartLeft) & "' y1='" & SvgNum(chartBottom) & "' x2='" & SvgNum(chartRight) & "' y2='" & SvgNum(chartBottom) & "' stroke='#d3d9e1' stroke-width='0.9'/>" & _
          "<polygon class='t-contour' points='" & pts & "' fill='none' stroke='#000000' stroke-width='2.2'/>" & _
          ArrowSvg(tailX, tailY, headX, headY, 2.4, "#000000") & _
          "<text class='t-nap-text' x='" & SvgNum(tailX + 10) & "' y='" & SvgNum(tailY - 12) & "'>" & SvgText("nap") & "</text>" & _
          infoSvg & _
          "</svg>"
    svg = ApplyTemplate("contour_a3_svg.xml", svg, "{{VIEW_W}}", CStr(viewW), "{{VIEW_H}}", CStr(viewH))
    svg = Replace(svg, "{{PLOT_X}}", SvgNum(plotX))
    svg = Replace(svg, "{{PLOT_Y}}", SvgNum(plotY))
    svg = Replace(svg, "{{PLOT_W}}", SvgNum(plotW))
    svg = Replace(svg, "{{PLOT_H}}", SvgNum(plotH))
    svg = Replace(svg, "{{GRID_LAYERS}}", gridSvgMinor & gridSvgMajor & edgeLabels)
    svg = Replace(svg, "{{CHART_LEFT}}", SvgNum(chartLeft))
    svg = Replace(svg, "{{CHART_TOP}}", SvgNum(chartTop))
    svg = Replace(svg, "{{CHART_RIGHT}}", SvgNum(chartRight))
    svg = Replace(svg, "{{CHART_BOTTOM}}", SvgNum(chartBottom))
    svg = Replace(svg, "{{PTS}}", pts)
    svg = Replace(svg, "{{NAP_ARROW}}", ArrowSvgClass(tailX, tailY, headX, headY, "t-nap-line", "t-nap-dot"))
    svg = Replace(svg, "{{NAP_TX}}", SvgNum(tailX + 10))
    svg = Replace(svg, "{{NAP_TY}}", SvgNum(tailY - 12))
    svg = Replace(svg, "{{PANEL_X}}", SvgNum(panelX))
    svg = Replace(svg, "{{PANEL_Y}}", SvgNum(panelY))
    svg = Replace(svg, "{{PANEL_W}}", SvgNum(panelW2))
    svg = Replace(svg, "{{PANEL_H}}", SvgNum(panelH))
    svg = Replace(svg, "{{INFO_X}}", SvgNum(infoX))
    svg = Replace(svg, "{{INFO_X2}}", SvgNum(infoX + infoW))
    svg = Replace(svg, "{{TITLE_Y}}", SvgNum(panelY + 22#))
    svg = Replace(svg, "{{TITLE_RULE_Y}}", SvgNum(panelY + 28#))
    svg = Replace(svg, "{{INFO_Y0}}", SvgNum(infoY + 0#))
    svg = Replace(svg, "{{INFO_Y1}}", SvgNum(infoY + 20#))
    svg = Replace(svg, "{{INFO_Y2}}", SvgNum(infoY + 40#))
    svg = Replace(svg, "{{INFO_Y3}}", SvgNum(infoY + 60#))
    svg = Replace(svg, "{{INFO_Y4}}", SvgNum(infoY + 80#))
    svg = Replace(svg, "{{INFO_LINE_0}}", SvgText(infoLines(0)))
    svg = Replace(svg, "{{INFO_LINE_1}}", SvgText(infoLines(1)))
    svg = Replace(svg, "{{INFO_LINE_2}}", SvgText(infoLines(2)))
    svg = Replace(svg, "{{INFO_LINE_3}}", SvgText(infoLines(3)))
    svg = Replace(svg, "{{INFO_LINE_4}}", SvgText(infoLines(4)))

    BuildContourSvgHtmlScanA3 = WrapSvgInHtmlTemplate(svg, "#f1f3f6")
End Function

Private Function WrapSvgInHtmlTemplate(ByVal svg As String, ByVal backgroundHex As String) As String
    Dim templateText As String

    templateText = LoadTemplateText("contour_preview_shell.html")
    If Len(templateText) = 0 Then
        WrapSvgInHtmlTemplate = "<html><head><meta charset='utf-8' /><meta http-equiv='X-UA-Compatible' content='IE=edge' />" & _
                                "<style>html,body{margin:0;padding:0;background:" & backgroundHex & ";height:100%;font-family:Segoe UI;}#c{width:100%;height:100%;}</style>" & _
                                "</head><body><div id='c'>" & svg & "</div></body></html>"
        Exit Function
    End If

    templateText = Replace(templateText, "{{BACKGROUND}}", backgroundHex)
    templateText = Replace(templateText, "{{SVG}}", svg)
    WrapSvgInHtmlTemplate = templateText
End Function

Private Function ApplyTemplate(ByVal templateFileName As String, ByVal fallbackText As String, ParamArray pairs() As Variant) As String
    Dim t As String
    Dim i As Long

    t = LoadTemplateText(templateFileName)
    If Len(t) = 0 Then
        ApplyTemplate = fallbackText
        Exit Function
    End If

    If (UBound(pairs) - LBound(pairs) + 1) Mod 2 <> 0 Then
        ApplyTemplate = fallbackText
        Exit Function
    End If

    For i = LBound(pairs) To UBound(pairs) Step 2
        t = Replace(t, CStr(pairs(i)), CStr(pairs(i + 1)))
    Next i

    ApplyTemplate = t
End Function

Private Function LoadTemplateText(ByVal templateFileName As String) As String
    On Error GoTo Fail
    Dim fullPath As String
    Dim stm As Object

    fullPath = CurrentProject.Path & "\vba\templates\" & templateFileName
    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2 ' adTypeText
    stm.Charset = "utf-8"
    stm.Open
    stm.LoadFromFile fullPath
    LoadTemplateText = CStr(stm.ReadText(-1))
    stm.Close
    Set stm = Nothing
    Exit Function
Fail:
    On Error Resume Next
    If Not stm Is Nothing Then
        stm.Close
        Set stm = Nothing
    End If
    LoadTemplateText = ""
End Function

Private Function SvgNum(ByVal d As Double) As String
    Dim s As String
    Dim v As Double

    v = Round(d, 3)
    s = Trim$(Str$(v))
    s = Replace(s, ",", ".")

    If InStr(1, s, "E", vbTextCompare) > 0 Then
        s = Replace(Format$(v, "0.000"), ",", ".")
    End If

    If s = "-0" Or s = "-0.0" Or s = "-0.00" Or s = "-0.000" Then
        s = "0"
    End If
    SvgNum = s
End Function

Private Function SvgText(ByVal s As String) As String
    Dim i As Long
    Dim ch As String
    Dim out As String
    Dim code As Long

    out = ""
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        code = AscW(ch)
        If code < 0 Then code = code + 65536

        Select Case ch
            Case "&"
                out = out & "&amp;"
            Case "<"
                out = out & "&lt;"
            Case ">"
                out = out & "&gt;"
            Case """"
                out = out & "&quot;"
            Case "'"
                out = out & "&#39;"
            Case Else
                If code < 32 Then
                    If code = 9 Or code = 10 Or code = 13 Then out = out & ch
                ElseIf code > 126 Then
                    out = out & "&#" & CStr(code) & ";"
                Else
                    out = out & ch
                End If
        End Select
    Next i
    SvgText = out
End Function

Private Function CalcMonoInfoBoxWidth(ByVal lines As Variant, ByVal fontSize As Double, _
                                      ByVal padLeft As Double, ByVal padRight As Double, _
                                      ByVal minWidth As Double) As Double
    Dim i As Long
    Dim maxLineW As Double
    Dim lineW As Double
    Dim w As Double

    maxLineW = 0#
    For i = LBound(lines) To UBound(lines)
        lineW = EstimateMonoLineWidthPx(CStr(lines(i)), fontSize)
        If lineW > maxLineW Then maxLineW = lineW
    Next i

    w = padLeft + padRight + maxLineW
    If w < minWidth Then w = minWidth
    CalcMonoInfoBoxWidth = w
End Function

Private Function EstimateMonoLineWidthPx(ByVal s As String, ByVal fontSize As Double) As Double
    Dim i As Long
    Dim ch As String
    Dim w As Double
    Dim t As String

    t = Replace(s, vbTab, "    ")
    w = 0#
    For i = 1 To Len(t)
        ch = Mid$(t, i, 1)
        Select Case ch
            Case " "
                w = w + fontSize * 0.28
            Case ".", ",", ":", ";", "!", "|", "(", ")", "[", "]", "{", "}"
                w = w + fontSize * 0.30
            Case "В°", "Г—"
                w = w + fontSize * 0.42
            Case Else
                w = w + fontSize * 0.52
        End Select
    Next i
    EstimateMonoLineWidthPx = w
End Function

Private Function ArrowSvg(ByVal x1 As Double, ByVal y1 As Double, ByVal x2 As Double, ByVal y2 As Double, ByVal strokeW As Double, ByVal colorHex As String) As String
    Dim a As Double
    Dim ah As Double
    Dim hx1 As Double, hy1 As Double, hx2 As Double, hy2 As Double

    a = Atan2Compat(y2 - y1, x2 - x1)
    ah = 10#
    hx1 = x2 - ah * Cos(a - 0.55)
    hy1 = y2 - ah * Sin(a - 0.55)
    hx2 = x2 - ah * Cos(a + 0.55)
    hy2 = y2 - ah * Sin(a + 0.55)

    ArrowSvg = "<line x1='" & SvgNum(x1) & "' y1='" & SvgNum(y1) & "' x2='" & SvgNum(x2) & "' y2='" & SvgNum(y2) & "' stroke='" & colorHex & "' stroke-width='" & SvgNum(strokeW) & "'/>" & _
               "<line x1='" & SvgNum(x2) & "' y1='" & SvgNum(y2) & "' x2='" & SvgNum(hx1) & "' y2='" & SvgNum(hy1) & "' stroke='" & colorHex & "' stroke-width='" & SvgNum(strokeW) & "'/>" & _
               "<line x1='" & SvgNum(x2) & "' y1='" & SvgNum(y2) & "' x2='" & SvgNum(hx2) & "' y2='" & SvgNum(hy2) & "' stroke='" & colorHex & "' stroke-width='" & SvgNum(strokeW) & "'/>" & _
               "<circle cx='" & SvgNum(x1) & "' cy='" & SvgNum(y1) & "' r='4' fill='" & colorHex & "'/>"
End Function

Private Function ArrowSvgClass(ByVal x1 As Double, ByVal y1 As Double, ByVal x2 As Double, ByVal y2 As Double, _
                               ByVal lineClass As String, ByVal dotClass As String) As String
    Dim a As Double
    Dim ah As Double
    Dim hx1 As Double, hy1 As Double, hx2 As Double, hy2 As Double
    Dim lineColor As String
    Dim lineWidth As String
    Dim dotColor As String

    a = Atan2Compat(y2 - y1, x2 - x1)
    ah = 10#
    hx1 = x2 - ah * Cos(a - 0.55)
    hy1 = y2 - ah * Sin(a - 0.55)
    hx2 = x2 - ah * Cos(a + 0.55)
    hy2 = y2 - ah * Sin(a + 0.55)

    Select Case LCase$(lineClass)
        Case "arrow-scan"
            lineColor = "#5a5a5a": lineWidth = "2"
        Case "arrow-norm"
            lineColor = "#111111": lineWidth = "3"
        Case "a3-nap-line", "t-nap-line"
            lineColor = "#000000": lineWidth = "2.4"
        Case Else
            lineColor = "#1f2328": lineWidth = "2"
    End Select

    Select Case LCase$(dotClass)
        Case "arrow-scan-dot"
            dotColor = "#5a5a5a"
        Case "arrow-norm-dot"
            dotColor = "#111111"
        Case "a3-nap-dot", "t-nap-dot"
            dotColor = "#000000"
        Case Else
            dotColor = "#1f2328"
    End Select

    ArrowSvgClass = "<line class='" & lineClass & "' x1='" & SvgNum(x1) & "' y1='" & SvgNum(y1) & "' x2='" & SvgNum(x2) & "' y2='" & SvgNum(y2) & "' stroke='" & lineColor & "' stroke-width='" & lineWidth & "' fill='none'/>" & _
                    "<line class='" & lineClass & "' x1='" & SvgNum(x2) & "' y1='" & SvgNum(y2) & "' x2='" & SvgNum(hx1) & "' y2='" & SvgNum(hy1) & "' stroke='" & lineColor & "' stroke-width='" & lineWidth & "' fill='none'/>" & _
                    "<line class='" & lineClass & "' x1='" & SvgNum(x2) & "' y1='" & SvgNum(y2) & "' x2='" & SvgNum(hx2) & "' y2='" & SvgNum(hy2) & "' stroke='" & lineColor & "' stroke-width='" & lineWidth & "' fill='none'/>" & _
                    "<circle class='" & dotClass & "' cx='" & SvgNum(x1) & "' cy='" & SvgNum(y1) & "' r='4' fill='" & dotColor & "'/>"
End Function

Private Sub RecomputeBounds(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long, ByRef minX As Double, ByRef maxX As Double, ByRef minY As Double, ByRef maxY As Double)
    Dim i As Long
    minX = xs(0): maxX = xs(0)
    minY = ys(0): maxY = ys(0)
    For i = 1 To n - 1
        If xs(i) < minX Then minX = xs(i)
        If xs(i) > maxX Then maxX = xs(i)
        If ys(i) < minY Then minY = ys(i)
        If ys(i) > maxY Then maxY = ys(i)
    Next i
End Sub

Private Sub SimplifyPolylineForPreview(ByRef xs() As Double, ByRef ys() As Double, ByRef n As Long, ByVal minStepMm As Double, ByVal minTurnDeg As Double)
    Dim passX() As Double
    Dim passY() As Double
    Dim outX() As Double
    Dim outY() As Double
    Dim i As Long
    Dim k As Long
    Dim d As Double
    Dim a As Double
    Dim changed As Boolean

    If n < 4 Then Exit Sub

    ' Pass 1: remove too-short consecutive steps.
    ReDim passX(0 To n - 1)
    ReDim passY(0 To n - 1)
    k = 0
    passX(k) = xs(0): passY(k) = ys(0): k = k + 1
    For i = 1 To n - 1
        d = Dist2D(xs(i), ys(i), passX(k - 1), passY(k - 1))
        If d >= minStepMm Then
            passX(k) = xs(i)
            passY(k) = ys(i)
            k = k + 1
        End If
    Next i
    If k < 3 Then Exit Sub
    ReDim Preserve passX(0 To k - 1)
    ReDim Preserve passY(0 To k - 1)

    ' Pass 2: remove near-collinear vertices; iterate until stable.
    Do
        changed = False
        ReDim outX(0 To k - 1)
        ReDim outY(0 To k - 1)
        outX(0) = passX(0): outY(0) = passY(0)
        n = 1
        For i = 1 To k - 2
            a = TurnAngleDeg(passX(i - 1), passY(i - 1), passX(i), passY(i), passX(i + 1), passY(i + 1))
            If a >= minTurnDeg Then
                outX(n) = passX(i)
                outY(n) = passY(i)
                n = n + 1
            Else
                changed = True
            End If
        Next i
        outX(n) = passX(k - 1): outY(n) = passY(k - 1): n = n + 1
        If n < 3 Then Exit Do
        ReDim Preserve outX(0 To n - 1)
        ReDim Preserve outY(0 To n - 1)
        ReDim passX(0 To n - 1)
        ReDim passY(0 To n - 1)
        For i = 0 To n - 1
            passX(i) = outX(i)
            passY(i) = outY(i)
        Next i
        k = n
    Loop While changed And k > 3

    ReDim xs(0 To k - 1)
    ReDim ys(0 To k - 1)
    For i = 0 To k - 1
        xs(i) = passX(i)
        ys(i) = passY(i)
    Next i
    n = k
End Sub

Private Function Dist2D(ByVal x1 As Double, ByVal y1 As Double, ByVal x2 As Double, ByVal y2 As Double) As Double
    Dist2D = Sqr((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1))
End Function

Private Function TurnAngleDeg(ByVal ax As Double, ByVal ay As Double, ByVal bx As Double, ByVal by As Double, ByVal cx As Double, ByVal cy As Double) As Double
    Dim v1x As Double, v1y As Double
    Dim v2x As Double, v2y As Double
    Dim l1 As Double, l2 As Double
    Dim dotP As Double
    Dim crossP As Double
    Dim ang As Double

    v1x = bx - ax: v1y = by - ay
    v2x = cx - bx: v2y = cy - by
    l1 = Sqr(v1x * v1x + v1y * v1y)
    l2 = Sqr(v2x * v2x + v2y * v2y)
    If l1 < 0.000001 Or l2 < 0.000001 Then
        TurnAngleDeg = 180#
        Exit Function
    End If
    dotP = (v1x * v2x + v1y * v2y) / (l1 * l2)
    crossP = (v1x * v2y - v1y * v2x) / (l1 * l2)
    ang = Abs(Atan2Compat(crossP, dotP)) * 57.2957795130823
    TurnAngleDeg = ang
End Function

Private Function ComputeViewRotateDeg(ByVal napDeg As Double) As Double
    Dim r As Double
    r = 90# - napDeg
    Do While r < 0#
        r = r + 360#
    Loop
    Do While r >= 360#
        r = r - 360#
    Loop
    ComputeViewRotateDeg = r
End Function

Private Sub RotatePointsClockwise(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long, ByVal degCW As Double)
    Dim cx As Double
    Dim cy As Double
    Dim i As Long
    Dim rad As Double
    Dim c As Double
    Dim s As Double
    Dim dx As Double
    Dim dy As Double
    Dim nx As Double
    Dim ny As Double

    ComputePolygonCentroid xs, ys, n, cx, cy
    rad = degCW * 3.14159265358979 / 180#
    c = Cos(rad)
    s = Sin(rad)

    For i = 0 To n - 1
        dx = xs(i) - cx
        dy = ys(i) - cy
        nx = dx * c - dy * s
        ny = dx * s + dy * c
        xs(i) = cx + nx
        ys(i) = cy + ny
    Next i
End Sub

Private Function PolygonAreaFromArrays(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long) As Double
    Dim i As Long
    Dim j As Long
    Dim s As Double
    s = 0#
    For i = 0 To n - 1
        j = i + 1
        If j = n Then j = 0
        s = s + (xs(i) * ys(j) - xs(j) * ys(i))
    Next i
    PolygonAreaFromArrays = Abs(s) / 2#
End Function

Private Function PolygonMaxSpanFromArrays(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long) As Double
    Dim i As Long
    Dim j As Long
    Dim dx As Double
    Dim dy As Double
    Dim d As Double
    Dim m As Double

    m = 0#
    For i = 0 To n - 1
        For j = i + 1 To n - 1
            dx = xs(i) - xs(j)
            dy = ys(i) - ys(j)
            d = Sqr(dx * dx + dy * dy)
            If d > m Then m = d
        Next j
    Next i
    PolygonMaxSpanFromArrays = m
End Function

Private Function IsSimplePolygonFromArrays(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long) As Boolean
    Dim i As Long
    Dim j As Long
    Dim ax1 As Double, ay1 As Double, ax2 As Double, ay2 As Double
    Dim bx1 As Double, by1 As Double, bx2 As Double, by2 As Double

    If n < 3 Then
        IsSimplePolygonFromArrays = False
        Exit Function
    End If

    For i = 0 To n - 1
        ax1 = xs(i): ay1 = ys(i)
        If i = n - 1 Then
            ax2 = xs(0): ay2 = ys(0)
        Else
            ax2 = xs(i + 1): ay2 = ys(i + 1)
        End If

        For j = i + 1 To n - 1
            If Abs(i - j) <= 1 Then GoTo NextJ
            If i = 0 And j = n - 1 Then GoTo NextJ

            bx1 = xs(j): by1 = ys(j)
            If j = n - 1 Then
                bx2 = xs(0): by2 = ys(0)
            Else
                bx2 = xs(j + 1): by2 = ys(j + 1)
            End If

            If SegmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) Then
                IsSimplePolygonFromArrays = False
                Exit Function
            End If
NextJ:
        Next j
    Next i

    IsSimplePolygonFromArrays = True
End Function

Private Function SegmentsIntersect(ByVal ax1 As Double, ByVal ay1 As Double, ByVal ax2 As Double, ByVal ay2 As Double, _
                                   ByVal bx1 As Double, ByVal by1 As Double, ByVal bx2 As Double, ByVal by2 As Double) As Boolean
    Dim d1 As Double
    Dim d2 As Double
    Dim d3 As Double
    Dim d4 As Double

    d1 = SegCross(ax1, ay1, ax2, ay2, bx1, by1)
    d2 = SegCross(ax1, ay1, ax2, ay2, bx2, by2)
    d3 = SegCross(bx1, by1, bx2, by2, ax1, ay1)
    d4 = SegCross(bx1, by1, bx2, by2, ax2, ay2)

    SegmentsIntersect = ((d1 > 0# And d2 < 0#) Or (d1 < 0# And d2 > 0#)) _
                     And ((d3 > 0# And d4 < 0#) Or (d3 < 0# And d4 > 0#))
End Function

Private Function SegCross(ByVal x1 As Double, ByVal y1 As Double, ByVal x2 As Double, ByVal y2 As Double, _
                          ByVal x3 As Double, ByVal y3 As Double) As Double
    SegCross = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1)
End Function

Private Sub OrderPointsByAngle(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long)
    Dim cx As Double
    Dim cy As Double
    Dim i As Long
    Dim ang() As Double

    If n < 3 Then Exit Sub

    cx = 0#: cy = 0#
    For i = 0 To n - 1
        cx = cx + xs(i)
        cy = cy + ys(i)
    Next i
    cx = cx / n
    cy = cy / n

    ReDim ang(0 To n - 1)
    For i = 0 To n - 1
        ang(i) = Atan2Compat(ys(i) - cy, xs(i) - cx)
    Next i

    QuickSortAnglesXY ang, xs, ys, 0, n - 1
End Sub

Private Function Atan2Compat(ByVal y As Double, ByVal x As Double) As Double
    If x > 0# Then
        Atan2Compat = Atn(y / x)
    ElseIf x < 0# Then
        If y >= 0# Then
            Atan2Compat = Atn(y / x) + 3.14159265358979
        Else
            Atan2Compat = Atn(y / x) - 3.14159265358979
        End If
    Else
        If y > 0# Then
            Atan2Compat = 1.5707963267949
        ElseIf y < 0# Then
            Atan2Compat = -1.5707963267949
        Else
            Atan2Compat = 0#
        End If
    End If
End Function

Private Sub QuickSortAnglesXY(ByRef ang() As Double, ByRef xs() As Double, ByRef ys() As Double, ByVal lo As Long, ByVal hi As Long)
    Dim i As Long
    Dim j As Long
    Dim p As Double
    Dim ta As Double
    Dim tx As Double
    Dim ty As Double

    i = lo
    j = hi
    p = ang((lo + hi) \ 2)

    Do While i <= j
        Do While ang(i) < p
            i = i + 1
        Loop
        Do While ang(j) > p
            j = j - 1
        Loop
        If i <= j Then
            ta = ang(i): ang(i) = ang(j): ang(j) = ta
            tx = xs(i): xs(i) = xs(j): xs(j) = tx
            ty = ys(i): ys(i) = ys(j): ys(j) = ty
            i = i + 1
            j = j - 1
        End If
    Loop

    If lo < j Then QuickSortAnglesXY ang, xs, ys, lo, j
    If i < hi Then QuickSortAnglesXY ang, xs, ys, i, hi
End Sub

Private Sub DrawAsciiLine(ByRef lines() As String, ByVal cols As Long, ByVal rows As Long, ByVal c1 As Long, ByVal r1 As Long, ByVal c2 As Long, ByVal r2 As Long, ByVal ch As String)
    Dim steps As Long
    Dim i As Long
    Dim cc As Long
    Dim rr As Long
    Dim dc As Double
    Dim dr As Double

    steps = Abs(c2 - c1)
    If Abs(r2 - r1) > steps Then steps = Abs(r2 - r1)
    If steps < 1 Then steps = 1

    dc = (c2 - c1) / steps
    dr = (r2 - r1) / steps

    For i = 0 To steps
        cc = CLng(c1 + dc * i)
        rr = CLng(r1 + dr * i)
        PlotChar lines, cols, rows, cc, rr, ch
    Next i
End Sub

Private Sub PlotChar(ByRef lines() As String, ByVal cols As Long, ByVal rows As Long, ByVal c As Long, ByVal r As Long, ByVal ch As String)
    Dim s As String
    If r < 1 Or r > rows Then Exit Sub
    If c < 1 Or c > cols Then Exit Sub
    s = lines(r)
    Mid$(s, c, 1) = ch
    lines(r) = s
End Sub

Private Function ParseContourPoints(ByVal contourJson As String, ByRef xs() As Double, ByRef ys() As Double, ByRef n As Long) As Boolean
    Dim pathKeyPos As Long
    Dim arrStart As Long
    Dim arrEnd As Long
    Dim objStart As Long
    Dim objEnd As Long
    Dim i As Long
    Dim chunk As String
    Dim xVal As Double
    Dim yVal As Double
    Dim hasX As Boolean
    Dim hasY As Boolean

    n = 0
    pathKeyPos = InStr(1, contourJson, """path""", vbTextCompare)
    If pathKeyPos = 0 Then pathKeyPos = InStr(1, contourJson, """points""", vbTextCompare)
    If pathKeyPos = 0 Then Exit Function

    arrStart = InStr(pathKeyPos, contourJson, "[", vbTextCompare)
    If arrStart = 0 Then Exit Function
    arrEnd = FindMatchingClose(contourJson, arrStart, "[", "]")
    If arrEnd = 0 Then Exit Function

    i = arrStart + 1
    Do While i < arrEnd
        objStart = InStr(i, contourJson, "{", vbTextCompare)
        If objStart = 0 Or objStart >= arrEnd Then Exit Do
        objEnd = FindMatchingClose(contourJson, objStart, "{", "}")
        If objEnd = 0 Or objEnd > arrEnd Then Exit Do

        chunk = Mid$(contourJson, objStart, objEnd - objStart + 1)
        hasX = TryReadKeyNumber(chunk, "x", xVal)
        hasY = TryReadKeyNumber(chunk, "y", yVal)

        If hasX And hasY Then
            ReDim Preserve xs(0 To n)
            ReDim Preserve ys(0 To n)
            xs(n) = xVal
            ys(n) = yVal
            n = n + 1
        End If

        i = objEnd + 1
    Loop

    ParseContourPoints = (n >= 3)
End Function

Private Function FindMatchingClose(ByVal s As String, ByVal openPos As Long, ByVal openCh As String, ByVal closeCh As String) As Long
    Dim i As Long
    Dim depth As Long
    Dim ch As String

    depth = 0
    For i = openPos To Len(s)
        ch = Mid$(s, i, 1)
        If ch = openCh Then
            depth = depth + 1
        ElseIf ch = closeCh Then
            depth = depth - 1
            If depth = 0 Then
                FindMatchingClose = i
                Exit Function
            End If
        End If
    Next i
    FindMatchingClose = 0
End Function

Private Function TryReadKeyNumber(ByVal jsonObj As String, ByVal keyName As String, ByRef outVal As Double) As Boolean
    Dim p As Long
    Dim c As Long
    Dim nx As Long
    Dim token As String

    p = InStr(1, jsonObj, """" & keyName & """", vbTextCompare)
    If p = 0 Then Exit Function
    c = InStr(p, jsonObj, ":", vbTextCompare)
    If c = 0 Then Exit Function

    token = ReadNumberToken(jsonObj, c + 1, nx)
    If Len(token) = 0 Then Exit Function

    outVal = ToDoubleInvariant(token)
    TryReadKeyNumber = True
End Function

Private Sub ComputePolygonCentroid(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long, ByRef cx As Double, ByRef cy As Double)
    Dim i As Long
    Dim j As Long
    Dim cross As Double
    Dim a As Double

    a = 0#
    cx = 0#
    cy = 0#
    For i = 0 To n - 1
        j = i + 1
        If j = n Then j = 0
        cross = xs(i) * ys(j) - xs(j) * ys(i)
        a = a + cross
        cx = cx + (xs(i) + xs(j)) * cross
        cy = cy + (ys(i) + ys(j)) * cross
    Next i

    If Abs(a) < 0.0000001 Then
        cx = 0#: cy = 0#
        For i = 0 To n - 1
            cx = cx + xs(i)
            cy = cy + ys(i)
        Next i
        cx = cx / n
        cy = cy / n
    Else
        cx = cx / (3# * a)
        cy = cy / (3# * a)
    End If
End Sub

Private Function EnsurePointInsidePolygon(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long, _
                                          ByRef px As Double, ByRef py As Double, _
                                          ByVal minX As Double, ByVal maxX As Double, ByVal minY As Double, ByVal maxY As Double) As Boolean
    Dim gx As Long
    Dim gy As Long
    Dim tx As Double
    Dim ty As Double
    Dim sx As Double
    Dim sy As Double

    If IsPointInPolygon(xs, ys, n, px, py) Then
        EnsurePointInsidePolygon = True
        Exit Function
    End If

    sx = (maxX - minX) / 10#
    sy = (maxY - minY) / 10#
    If sx = 0# Then sx = 1#
    If sy = 0# Then sy = 1#

    For gy = 5 To -5 Step -1
        For gx = -5 To 5
            tx = (minX + maxX) / 2# + gx * sx * 0.4
            ty = (minY + maxY) / 2# + gy * sy * 0.4
            If IsPointInPolygon(xs, ys, n, tx, ty) Then
                px = tx
                py = ty
                EnsurePointInsidePolygon = True
                Exit Function
            End If
        Next gx
    Next gy

    EnsurePointInsidePolygon = False
End Function

Private Function IsPointInPolygon(ByRef xs() As Double, ByRef ys() As Double, ByVal n As Long, ByVal px As Double, ByVal py As Double) As Boolean
    Dim i As Long
    Dim j As Long
    Dim inside As Boolean
    Dim yi As Double, yj As Double
    Dim xi As Double, xj As Double
    Dim xCross As Double

    inside = False
    j = n - 1
    For i = 0 To n - 1
        xi = xs(i): yi = ys(i)
        xj = xs(j): yj = ys(j)
        If ((yi > py) <> (yj > py)) Then
            xCross = xi + (py - yi) * (xj - xi) / (yj - yi)
            If px < xCross Then inside = Not inside
        End If
        j = i
    Next i
    IsPointInPolygon = inside
End Function

Private Function ToDoubleInvariant(ByVal s As String) As Double
    Dim t As String
    t = Trim$(s)
    t = Replace(t, ",", ".")
    ToDoubleInvariant = Val(t)
End Function

Private Function ReadNumberToken(ByVal s As String, ByVal startPos As Long, ByRef nextPos As Long) As String
    Dim i As Long
    Dim ch As String
    Dim token As String

    i = startPos
    Do While i <= Len(s)
        ch = Mid$(s, i, 1)
        If ch = " " Or ch = vbTab Or ch = vbCr Or ch = vbLf Then
            i = i + 1
        Else
            Exit Do
        End If
    Loop

    token = ""
    Do While i <= Len(s)
        ch = Mid$(s, i, 1)
        If (ch >= "0" And ch <= "9") Or ch = "+" Or ch = "-" Or ch = "." Or ch = "," Or ch = "e" Or ch = "E" Then
            token = token & ch
            i = i + 1
        Else
            Exit Do
        End If
    Loop

    nextPos = i
    ReadNumberToken = token
End Function
