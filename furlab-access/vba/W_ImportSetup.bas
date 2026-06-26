Attribute VB_Name = "W_ImportSetup"
Option Compare Database
Option Explicit

' Stage 5:
' A5.1 Contract CSV import into staging (ImportBatch, ImportSpecLine)
' A5.3 Apply staging -> LayoutRun, LayoutRunScrapPlacement

Public Sub W_CreateImportTemplateCsv()
    Dim filePath As String
    Dim folderPath As String
    Dim ff As Integer
    filePath = InputBox("Enter full output path for template CSV:", "W import template", "")
    filePath = Trim$(filePath)
    If Len(filePath) = 0 Then Exit Sub

    folderPath = GetParentFolder(filePath)
    If Len(folderPath) > 0 Then EnsureFolderExists folderPath

    On Error GoTo TemplateErr
    ff = FreeFile
    Open filePath For Output As #ff
    Print #ff, "batchSourceName,createdAt,fragmentCode,inventoryTag,rotationDeg,offsetXmm,offsetYmm,zoneNo,partNo,modelNo"
    Print #ff, "Batch_A,2026-02-12 12:00:00,2-21-1,TAG-0001,0,10,20,21,2,1"
    Print #ff, "Batch_A,2026-02-12 12:00:00,2-21-2,TAG-0002,15,12,22,21,2,1"
    Print #ff, "Batch_A,2026-02-12 12:00:00,2-21-3,TAG-0003,30,14,24,21,2,1"
    Close #ff

    MsgBox "Template CSV created:" & vbCrLf & filePath, vbInformation, "W import"
    Exit Sub

TemplateErr:
    On Error Resume Next
    If ff <> 0 Then Close #ff
    MsgBox "Cannot create template CSV." & vbCrLf & _
           "Path: " & filePath & vbCrLf & _
           "Error: " & Err.Description, vbCritical, "W import"
End Sub

Public Sub W_ImportCsvToStaging()
    Dim csvPath As String
    csvPath = InputBox("Enter full CSV path:", "W import CSV", "")
    csvPath = Trim$(csvPath)
    If Len(csvPath) = 0 Then Exit Sub
    W_ImportCsvToStagingFromFile csvPath
End Sub

Public Sub W_ImportCsvToStagingFromFile(ByVal csvPath As String)
    Dim db As DAO.Database
    Dim ff As Integer
    Dim lineText As String
    Dim lineNo As Long
    Dim inserted As Long
    Dim values As Variant
    Dim map As Object
    Dim useHeader As Boolean
    Dim batchId As String
    Dim batchSourceName As String
    Dim batchCreatedAt As Variant
    Dim sourceName As String
    Dim createdAtSql As String

    On Error GoTo ImportErr

    If Dir$(csvPath) = vbNullString Then
        MsgBox "CSV not found: " & csvPath, vbExclamation
        Exit Sub
    End If

    Set db = CurrentDb
    EnsureImportSchemaColumns db

    ff = FreeFile
    Open csvPath For Input As #ff
    lineNo = 0
    useHeader = False
    Set map = CreateObject("Scripting.Dictionary")

    batchId = NewGuidToken()
    sourceName = GetFileName(csvPath)
    batchSourceName = sourceName
    batchCreatedAt = Null

    ' Create parent batch first to satisfy FK ImportSpecLine.batchId -> ImportBatch.id
    createdAtSql = "#" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & "#"
    db.Execute "INSERT INTO ImportBatch (id, sourceName, createdAt) VALUES (" & _
               batchId & ", " & SqlTextOrNull(batchSourceName) & ", " & createdAtSql & ")", dbFailOnError

    Do While Not EOF(ff)
        Line Input #ff, lineText
        lineNo = lineNo + 1
        If Len(Trim$(lineText)) = 0 Then GoTo ContinueLoop

        values = ParseCsvLine(lineText)
        If lineNo = 1 Then
            BuildHeaderMap map, values
            useHeader = HeaderHasContract(map)
            If useHeader Then GoTo ContinueLoop
        End If

        If useHeader Then
            If inserted = 0 Then
                batchSourceName = Nz(GetByMap(values, map, "batchSourceName"), sourceName)
                If Len(Trim$(batchSourceName)) = 0 Then batchSourceName = sourceName
                batchCreatedAt = ParseDateOrNull(GetByMap(values, map, "createdAt"))
            End If
            InsertImportSpecLineContract db, batchId, values, map
        Else
            If inserted = 0 Then
                batchSourceName = sourceName
                batchCreatedAt = Null
            End If
            InsertImportSpecLineLegacy db, batchId, values
        End If
        inserted = inserted + 1
ContinueLoop:
    Loop
    Close #ff

    ' If contract file provided batch metadata, update parent batch
    If Not IsNull(batchCreatedAt) Or (batchSourceName <> sourceName) Then
        If IsNull(batchCreatedAt) Then
            createdAtSql = "#" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & "#"
        Else
            createdAtSql = "#" & Format$(CDate(batchCreatedAt), "yyyy-mm-dd hh:nn:ss") & "#"
        End If

        db.Execute "UPDATE ImportBatch SET " & _
                   "sourceName=" & SqlTextOrNull(batchSourceName) & ", " & _
                   "createdAt=" & createdAtSql & _
                   " WHERE id=" & batchId, dbFailOnError
    End If

    MsgBox "CSV imported to staging." & vbCrLf & _
           "BatchId: " & batchId & vbCrLf & _
           "Rows: " & inserted & vbCrLf & _
           "Mode: " & IIf(useHeader, "Contract", "Legacy"), vbInformation, "W import"
    Exit Sub

ImportErr:
    On Error Resume Next
    If ff <> 0 Then Close #ff
    MsgBox "Import CSV failed." & vbCrLf & _
           "Path: " & csvPath & vbCrLf & _
           "Line: " & lineNo & vbCrLf & _
           "Error: " & Err.Description, vbCritical, "W import"
End Sub

Public Sub W_ApplyImportBatch()
    Dim batchId As String
    Dim layoutId As String
    batchId = Trim$(InputBox("Enter batch GUID (ImportBatch.id):", "Apply import", ""))
    If Len(batchId) = 0 Then Exit Sub

    layoutId = Trim$(InputBox("Enter layout GUID (Layout.id):", "Apply import", ""))
    If Len(layoutId) = 0 Then
        MsgBox "layoutId is required by current schema (LayoutRun.layoutId NOT NULL).", vbExclamation
        Exit Sub
    End If

    W_ApplyImportBatchById batchId, layoutId, False
End Sub

Public Sub W_ApplyImportBatchById(ByVal batchId As String, ByVal layoutId As String, Optional ByVal promoteToUsed As Boolean = False)
    Dim db As DAO.Database
    Dim wrk As DAO.Workspace
    Dim rs As DAO.Recordset
    Dim sql As String
    Dim layoutRunId As String
    Dim fragCode As String
    Dim invTag As String
    Dim fragId As Variant
    Dim scrapId As Variant
    Dim rotationDeg As Variant
    Dim offsetXmm As Variant
    Dim offsetYmm As Variant
    Dim nowSql As String
    Dim applied As Long
    Dim skipped As Long

    Set db = CurrentDb
    Set wrk = DBEngine.Workspaces(0)
    EnsureImportSchemaColumns db

    If DCount("*", "ImportBatch", "id=" & QuoteGuid(batchId)) = 0 Then
        MsgBox "ImportBatch not found: " & batchId, vbExclamation
        Exit Sub
    End If

    If DCount("*", "Layout", "id=" & QuoteGuid(layoutId)) = 0 Then
        MsgBox "Layout not found: " & layoutId, vbExclamation
        Exit Sub
    End If

    layoutRunId = NewGuidToken()
    nowSql = "#" & Format$(Now, "yyyy-mm-dd hh:nn:ss") & "#"

    wrk.BeginTrans
    On Error GoTo ApplyErr

    db.Execute "INSERT INTO LayoutRun (id, layoutId, startedAt, paramsSnapshot, resultSnapshot) VALUES (" & _
               layoutRunId & ", " & QuoteGuid(layoutId) & ", " & nowSql & ", " & _
               SqlTextOrNull("{""source"":""ImportSpecLine"",""batchId"":""" & batchId & """}") & ", Null)", dbFailOnError

    sql = "SELECT fragmentCode, inventoryTag, rotationDeg, offsetXmm, offsetYmm " & _
          "FROM ImportSpecLine WHERE batchId=" & QuoteGuid(batchId)
    Set rs = db.OpenRecordset(sql, dbOpenSnapshot)

    Do While Not rs.EOF
        fragCode = Nz(rs.Fields("fragmentCode").Value, "")
        invTag = Nz(rs.Fields("inventoryTag").Value, "")
        rotationDeg = rs.Fields("rotationDeg").Value
        offsetXmm = rs.Fields("offsetXmm").Value
        offsetYmm = rs.Fields("offsetYmm").Value

        fragId = Null
        scrapId = Null
        If Len(fragCode) > 0 Then
            fragId = DLookup("id", "Fragment", "fragmentCode=" & SqlTextOrNull(fragCode))
        End If
        If Len(invTag) > 0 Then
            scrapId = DLookup("id", "ScrapPiece", "inventoryTag=" & SqlTextOrNull(invTag))
        End If

        If IsNull(fragId) Or IsNull(scrapId) Then
            skipped = skipped + 1
        Else
            UpsertPlacement db, layoutRunId, fragId, scrapId, rotationDeg, offsetXmm, offsetYmm

            If promoteToUsed Then
                db.Execute "UPDATE ScrapPiece SET scrapStatus='Used', updatedAt=" & nowSql & _
                           " WHERE id=" & QuoteGuid(CStr(scrapId)) & " AND scrapStatus='Available'", dbFailOnError
            End If
            applied = applied + 1
        End If
        rs.MoveNext
    Loop

    rs.Close
    wrk.CommitTrans

    MsgBox "Apply completed." & vbCrLf & _
           "layoutRunId: " & layoutRunId & vbCrLf & _
           "Applied: " & applied & vbCrLf & _
           "Skipped: " & skipped, vbInformation, "W import apply"
    Exit Sub

ApplyErr:
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    wrk.Rollback
    MsgBox "Apply failed: " & Err.Description, vbCritical
End Sub

Private Sub UpsertPlacement(ByVal db As DAO.Database, ByVal layoutRunId As String, ByVal fragmentId As Variant, ByVal scrapId As Variant, ByVal rotationDeg As Variant, ByVal offsetXmm As Variant, ByVal offsetYmm As Variant)
    Dim whereKey As String
    whereKey = "layoutRunId=" & QuoteGuid(layoutRunId) & " AND fragmentId=" & QuoteGuid(CStr(fragmentId))

    If DCount("*", "LayoutRunScrapPlacement", whereKey) = 0 Then
        db.Execute "INSERT INTO LayoutRunScrapPlacement (" & _
                   "layoutRunId, fragmentId, scrapPieceId, rotationDeg, offsetXmm, offsetYmm, resultContourSnapshot) VALUES (" & _
                   QuoteGuid(layoutRunId) & ", " & QuoteGuid(CStr(fragmentId)) & ", " & QuoteGuid(CStr(scrapId)) & ", " & _
                   SqlDoubleValueOrNull(rotationDeg) & ", " & _
                   SqlDoubleValueOrNull(offsetXmm) & ", " & _
                   SqlDoubleValueOrNull(offsetYmm) & ", Null)", dbFailOnError
    Else
        db.Execute "UPDATE LayoutRunScrapPlacement SET " & _
                   "scrapPieceId=" & QuoteGuid(CStr(scrapId)) & ", " & _
                   "rotationDeg=" & SqlDoubleValueOrNull(rotationDeg) & ", " & _
                   "offsetXmm=" & SqlDoubleValueOrNull(offsetXmm) & ", " & _
                   "offsetYmm=" & SqlDoubleValueOrNull(offsetYmm) & _
                   " WHERE " & whereKey, dbFailOnError
    End If
End Sub

Private Sub EnsureImportSchemaColumns(ByVal db As DAO.Database)
    ExecIgnore db, "ALTER TABLE ImportSpecLine ADD COLUMN rotationDeg DOUBLE"
    ExecIgnore db, "ALTER TABLE ImportSpecLine ADD COLUMN offsetXmm DOUBLE"
    ExecIgnore db, "ALTER TABLE ImportSpecLine ADD COLUMN offsetYmm DOUBLE"
End Sub

Private Sub ExecIgnore(ByVal db As DAO.Database, ByVal sqlText As String)
    On Error Resume Next
    db.Execute sqlText
    Err.Clear
    On Error GoTo 0
End Sub

Private Sub InsertImportSpecLineContract(ByVal db As DAO.Database, ByVal batchId As String, ByVal values As Variant, ByVal map As Object)
    Dim modelNo As String
    Dim partNo As String
    Dim zoneNo As String
    Dim fragmentCode As String
    Dim inventoryTag As String
    Dim rotationDeg As String
    Dim offsetXmm As String
    Dim offsetYmm As String

    modelNo = Nz(GetByMap(values, map, "modelNo"), "")
    partNo = Nz(GetByMap(values, map, "partNo"), "")
    zoneNo = Nz(GetByMap(values, map, "zoneNo"), "")
    fragmentCode = Nz(GetByMap(values, map, "fragmentCode"), "")
    inventoryTag = Nz(GetByMap(values, map, "inventoryTag"), "")
    rotationDeg = Nz(GetByMap(values, map, "rotationDeg"), "")
    offsetXmm = Nz(GetByMap(values, map, "offsetXmm"), "")
    offsetYmm = Nz(GetByMap(values, map, "offsetYmm"), "")

    db.Execute "INSERT INTO ImportSpecLine (" & _
               "id, batchId, modelNo, partNo, zoneNo, fragmentCode, qty, areaMm2, napDirectionDeg, inventoryTag, layoutRunIdText, rotationDeg, offsetXmm, offsetYmm" & _
               ") VALUES (" & _
               NewGuidToken() & ", " & batchId & ", " & _
               SqlLongOrNull(modelNo) & ", " & SqlLongOrNull(partNo) & ", " & SqlLongOrNull(zoneNo) & ", " & _
               SqlTextOrNull(fragmentCode) & ", Null, Null, Null, " & SqlTextOrNull(inventoryTag) & ", Null, " & _
               SqlDoubleOrNull(rotationDeg) & ", " & SqlDoubleOrNull(offsetXmm) & ", " & SqlDoubleOrNull(offsetYmm) & ")", dbFailOnError
End Sub

Private Sub InsertImportSpecLineLegacy(ByVal db As DAO.Database, ByVal batchId As String, ByVal values As Variant)
    Dim vModelNo As String
    Dim vPartNo As String
    Dim vZoneNo As String
    Dim vFragmentCode As String
    Dim vQty As String
    Dim vAreaMm2 As String
    Dim vNapDirectionDeg As String
    Dim vInventoryTag As String
    Dim vLayoutRunIdText As String

    vModelNo = GetCsvValue(values, 0)
    vPartNo = GetCsvValue(values, 1)
    vZoneNo = GetCsvValue(values, 2)
    vFragmentCode = GetCsvValue(values, 3)
    vQty = GetCsvValue(values, 4)
    vAreaMm2 = GetCsvValue(values, 5)
    vNapDirectionDeg = GetCsvValue(values, 6)
    vInventoryTag = GetCsvValue(values, 7)
    vLayoutRunIdText = GetCsvValue(values, 8)

    db.Execute "INSERT INTO ImportSpecLine (" & _
               "id, batchId, modelNo, partNo, zoneNo, fragmentCode, qty, areaMm2, napDirectionDeg, inventoryTag, layoutRunIdText, rotationDeg, offsetXmm, offsetYmm" & _
               ") VALUES (" & _
               NewGuidToken() & ", " & batchId & ", " & _
               SqlLongOrNull(vModelNo) & ", " & SqlLongOrNull(vPartNo) & ", " & SqlLongOrNull(vZoneNo) & ", " & _
               SqlTextOrNull(vFragmentCode) & ", " & SqlLongOrNull(vQty) & ", " & SqlDoubleOrNull(vAreaMm2) & ", " & _
               SqlDoubleOrNull(vNapDirectionDeg) & ", " & SqlTextOrNull(vInventoryTag) & ", " & SqlTextOrNull(vLayoutRunIdText) & ", Null, Null, Null)", dbFailOnError
End Sub

Private Function ParseDateOrNull(ByVal s As String) As Variant
    s = Trim$(s)
    If Len(s) = 0 Then
        ParseDateOrNull = Null
    ElseIf IsDate(s) Then
        ParseDateOrNull = CDate(s)
    Else
        ParseDateOrNull = Null
    End If
End Function

Private Sub BuildHeaderMap(ByVal map As Object, ByVal values As Variant)
    Dim i As Long
    Dim key As String
    map.RemoveAll
    If Not IsArray(values) Then Exit Sub
    For i = LBound(values) To UBound(values)
        key = LCase$(Trim$(CStr(values(i))))
        If Len(key) > 0 Then map(key) = i
    Next i
End Sub

Private Function HeaderHasContract(ByVal map As Object) As Boolean
    HeaderHasContract = (map.Exists("fragmentcode") And map.Exists("inventorytag"))
End Function

Private Function GetByMap(ByVal values As Variant, ByVal map As Object, ByVal key As String) As String
    key = LCase$(key)
    If map.Exists(key) Then
        GetByMap = GetCsvValue(values, CLng(map(key)))
    Else
        GetByMap = ""
    End If
End Function

Private Function GetCsvValue(ByVal values As Variant, ByVal idx As Long) As String
    If IsArray(values) Then
        If idx >= LBound(values) And idx <= UBound(values) Then
            GetCsvValue = Trim$(CStr(values(idx)))
            Exit Function
        End If
    End If
    GetCsvValue = ""
End Function

Private Function ParseCsvLine(ByVal lineText As String) As Variant
    Dim result() As String
    Dim i As Long
    Dim ch As String
    Dim cur As String
    Dim inQuotes As Boolean
    Dim n As Long

    ReDim result(0 To 0)
    n = 0
    cur = ""
    inQuotes = False

    For i = 1 To Len(lineText)
        ch = Mid$(lineText, i, 1)
        If ch = """" Then
            If inQuotes And i < Len(lineText) And Mid$(lineText, i + 1, 1) = """" Then
                cur = cur & """"
                i = i + 1
            Else
                inQuotes = Not inQuotes
            End If
        ElseIf ch = "," And Not inQuotes Then
            result(n) = cur
            n = n + 1
            ReDim Preserve result(0 To n)
            cur = ""
        Else
            cur = cur & ch
        End If
    Next i
    result(n) = cur
    ParseCsvLine = result
End Function

Private Function SqlTextOrNull(ByVal valueText As String) As String
    valueText = Trim$(valueText)
    If Len(valueText) = 0 Then
        SqlTextOrNull = "Null"
    Else
        SqlTextOrNull = "'" & Replace(valueText, "'", "''") & "'"
    End If
End Function

Private Function SqlLongOrNull(ByVal valueText As String) As String
    valueText = Replace(Trim$(valueText), " ", "")
    If Len(valueText) = 0 Then
        SqlLongOrNull = "Null"
    ElseIf IsNumeric(valueText) Then
        SqlLongOrNull = CStr(CLng(valueText))
    Else
        SqlLongOrNull = "Null"
    End If
End Function

Private Function SqlDoubleOrNull(ByVal valueText As String) As String
    Dim t As String
    t = Replace(Trim$(valueText), " ", "")
    t = Replace(t, ",", ".")
    If Len(t) = 0 Then
        SqlDoubleOrNull = "Null"
    ElseIf IsNumeric(t) Then
        SqlDoubleOrNull = Replace(CStr(CDbl(t)), ",", ".")
    Else
        SqlDoubleOrNull = "Null"
    End If
End Function

Private Function SqlDoubleValueOrNull(ByVal valueVal As Variant) As String
    If IsNull(valueVal) Then
        SqlDoubleValueOrNull = "Null"
    Else
        SqlDoubleValueOrNull = SqlDoubleOrNull(CStr(valueVal))
    End If
End Function

Private Function NewGuidToken() As String
    NewGuidToken = "'{" & GenerateGuidLike() & "}'"
End Function

Private Function QuoteGuid(ByVal guidValue As String) As String
    Dim s As String
    s = Replace(Replace(Trim$(guidValue), "{", ""), "}", "")
    QuoteGuid = "'{" & s & "}'"
End Function

Private Function GetFileName(ByVal fullPath As String) As String
    Dim p As Long
    p = InStrRev(fullPath, "\")
    If p > 0 Then
        GetFileName = Mid$(fullPath, p + 1)
    Else
        GetFileName = fullPath
    End If
End Function

Private Function GenerateGuidLike() As String
    Dim s As String
    Dim i As Long

    Randomize Timer
    s = ""
    For i = 1 To 32
        s = s & Mid$("0123456789abcdef", Int(Rnd() * 16) + 1, 1)
    Next i

    ' UUID v4-like shape: 8-4-4-4-12
    Mid$(s, 13, 1) = "4"
    Mid$(s, 17, 1) = Mid$("89ab", Int(Rnd() * 4) + 1, 1)
    GenerateGuidLike = Left$(s, 8) & "-" & Mid$(s, 9, 4) & "-" & Mid$(s, 13, 4) & "-" & Mid$(s, 17, 4) & "-" & Right$(s, 12)
End Function

Private Function GetParentFolder(ByVal filePath As String) As String
    Dim p As Long
    p = InStrRev(filePath, "\")
    If p > 0 Then
        GetParentFolder = Left$(filePath, p - 1)
    Else
        GetParentFolder = vbNullString
    End If
End Function

Private Sub EnsureFolderExists(ByVal folderPath As String)
    Dim i As Long
    Dim pieces() As String
    Dim cur As String

    If Len(folderPath) = 0 Then Exit Sub
    If Dir$(folderPath, vbDirectory) <> vbNullString Then Exit Sub

    pieces = Split(folderPath, "\")
    If UBound(pieces) < 0 Then Exit Sub

    cur = pieces(0)
    For i = 1 To UBound(pieces)
        cur = cur & "\" & pieces(i)
        If Dir$(cur, vbDirectory) = vbNullString Then MkDir cur
    Next i
End Sub
