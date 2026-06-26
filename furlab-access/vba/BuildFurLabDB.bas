Attribute VB_Name = "BuildFurLabDB"
Option Compare Database
Option Explicit

' Entry point: runs the Jet/ACE-compatible schema script from the repository.
Public Sub BuildFurLabDB_JetCompatible()
    Dim sqlPath As String
    sqlPath = ResolveDefaultSqlPath("003_init_access_jet_w_ui_schema.sql")
    If Len(sqlPath) = 0 Then
        sqlPath = PromptForSqlPath("003_init_access_jet_w_ui_schema.sql")
        If Len(sqlPath) = 0 Then
            MsgBox "SQL script not found. Place file in .\sql\003_init_access_jet_w_ui_schema.sql or select full path manually.", vbExclamation
            Exit Sub
        End If
    End If

    RunSqlScript sqlPath, True
End Sub

' Generic entry point: executes any SQL script file.
Public Sub BuildFurLabDB_FromFile(ByVal sqlFilePath As String)
    RunSqlScript sqlFilePath, True
End Sub

' Rebuild mode: DROP + CREATE script. Continues on DROP errors for missing objects.
Public Sub RebuildFurLabDB_JetCompatible()
    Dim sqlPath As String
    sqlPath = ResolveDefaultSqlPath("004_rebuild_access_jet_w_ui_schema.sql")
    If Len(sqlPath) = 0 Then
        sqlPath = PromptForSqlPath("004_rebuild_access_jet_w_ui_schema.sql")
        If Len(sqlPath) = 0 Then
            MsgBox "Rebuild SQL script not found. Place file in .\sql\004_rebuild_access_jet_w_ui_schema.sql or select full path manually.", vbExclamation
            Exit Sub
        End If
    End If

    RunSqlScript sqlPath, False
End Sub

' Seed UI captions dictionary using safe VBA seeder (encoding-safe).
Public Sub SeedUiTextDict()
    W_SeedUiTextDict
End Sub

Private Sub RunSqlScript(ByVal sqlFilePath As String, ByVal stopOnError As Boolean)
    Dim db As DAO.Database
    Dim scriptText As String
    Dim statements As Collection
    Dim i As Long
    Dim stmt As String
    Dim executedCount As Long
    Dim failedCount As Long
    Dim logPath As String

    If Len(Trim$(sqlFilePath)) = 0 Then
        MsgBox "SQL file path is empty.", vbExclamation
        Exit Sub
    End If

    If Dir$(sqlFilePath) = vbNullString Then
        MsgBox "SQL file not found: " & sqlFilePath, vbCritical
        Exit Sub
    End If

    scriptText = ReadAllText(sqlFilePath)
    If Len(scriptText) = 0 Then
        MsgBox "SQL file is empty: " & sqlFilePath, vbExclamation
        Exit Sub
    End If

    Set statements = SplitSqlStatements(scriptText)
    If statements.Count = 0 Then
        MsgBox "No SQL statements found in file: " & sqlFilePath, vbExclamation
        Exit Sub
    End If

    logPath = ResolveDefaultLogPath()
    EnsureFolderExists GetParentFolder(logPath)
    WriteLog logPath, "===== Build start: " & sqlFilePath & " ====="

    Set db = CurrentDb
    For i = 1 To statements.Count
        stmt = statements(i)
        On Error GoTo ExecError
        db.Execute stmt, dbFailOnError
        executedCount = executedCount + 1
        On Error GoTo 0
ContinueLoop:
    Next i

    WriteLog logPath, "Build completed. Executed=" & executedCount & ", Failed=" & failedCount
    MsgBox "Build completed." & vbCrLf & _
           "Executed: " & executedCount & vbCrLf & _
           "Failed: " & failedCount & vbCrLf & _
           "Log: " & logPath, IIf(failedCount = 0, vbInformation, vbExclamation)
    Exit Sub

ExecError:
    If IsIgnorableRebuildError(Err.Number, stmt, stopOnError) Then
        WriteLog logPath, "IGNORED #" & Err.Number & ": " & Err.Description
        WriteLog logPath, "Statement #" & CStr(i) & ": " & stmt
        WriteLog logPath, "-----"
        Err.Clear
        Resume ContinueLoop
    End If

    failedCount = failedCount + 1
    WriteLog logPath, "ERROR #" & Err.Number & ": " & Err.Description
    WriteLog logPath, "Statement #" & CStr(i) & ": " & stmt
    WriteLog logPath, "-----"

    If stopOnError Then
        MsgBox "Build stopped on SQL error." & vbCrLf & _
               "Statement #" & CStr(i) & vbCrLf & _
               "Error #" & Err.Number & ": " & Err.Description & vbCrLf & _
               "See log: " & logPath, vbCritical
        Exit Sub
    End If

    Err.Clear
    Resume ContinueLoop
End Sub

Private Function SplitSqlStatements(ByVal scriptText As String) As Collection
    Dim cleaned As String
    Dim parts As New Collection
    Dim buf As String
    Dim i As Long
    Dim ch As String
    Dim inString As Boolean
    Dim stmt As String

    cleaned = RemoveCommentLines(scriptText)
    cleaned = Replace(cleaned, vbCrLf, vbLf)
    cleaned = Replace(cleaned, vbCr, vbLf)
    If Len(cleaned) > 0 Then
        If AscW(Left$(cleaned, 1)) = &HFEFF Then
            cleaned = Mid$(cleaned, 2)
        End If
    End If

    For i = 1 To Len(cleaned)
        ch = Mid$(cleaned, i, 1)

        If ch = "'" Then
            If inString Then
                If i < Len(cleaned) And Mid$(cleaned, i + 1, 1) = "'" Then
                    buf = buf & "''"
                    i = i + 1
                    GoTo NextChar
                Else
                    inString = False
                End If
            Else
                inString = True
            End If
        End If

        If ch = ";" And Not inString Then
            stmt = CleanSqlStatement(buf)
            If Len(stmt) > 0 Then parts.Add stmt
            buf = vbNullString
        Else
            buf = buf & ch
        End If
NextChar:
    Next i

    stmt = CleanSqlStatement(buf)
    If Len(stmt) > 0 Then parts.Add stmt

    Set SplitSqlStatements = parts
End Function

Private Function CleanSqlStatement(ByVal s As String) As String
    Dim t As String
    t = Replace(s, vbCr, " ")
    t = Replace(t, vbLf, " ")
    t = Replace(t, vbTab, " ")
    t = Replace(t, ChrW(&HA0), " ")
    t = Trim$(t)
    Do While InStr(t, "  ") > 0
        t = Replace(t, "  ", " ")
    Loop
    CleanSqlStatement = t
End Function

Private Function IsIgnorableRebuildError(ByVal errNo As Long, ByVal stmt As String, ByVal stopOnError As Boolean) As Boolean
    Dim s As String
    s = UCase$(CleanSqlStatement(stmt))
    If stopOnError Then
        IsIgnorableRebuildError = False
        Exit Function
    End If

    If errNo = 3376 And Left$(s, 10) = "DROP TABLE" Then
        IsIgnorableRebuildError = True
        Exit Function
    End If

    If errNo = 3078 And Len(s) = 0 Then
        IsIgnorableRebuildError = True
        Exit Function
    End If

    IsIgnorableRebuildError = False
End Function

Private Function RemoveCommentLines(ByVal text As String) As String
    Dim normalized As String
    Dim lines() As String
    Dim i As Long
    Dim lineText As String
    Dim t As String
    Dim out As String

    normalized = Replace(text, vbCrLf, vbLf)
    normalized = Replace(normalized, vbCr, vbLf)
    lines = Split(normalized, vbLf)

    For i = LBound(lines) To UBound(lines)
        lineText = lines(i)
        t = LTrim$(lineText)
        If Left$(t, 2) <> "--" Then
            out = out & lineText & vbLf
        End If
    Next i

    RemoveCommentLines = out
End Function

Private Function ReadAllText(ByVal filePath As String) As String
    On Error GoTo FallbackAnsi
    Dim stm As Object

    Set stm = CreateObject("ADODB.Stream")
    stm.Type = 2 ' adTypeText
    stm.Mode = 3 ' adModeReadWrite
    stm.Charset = "utf-8"
    stm.Open
    stm.LoadFromFile filePath
    ReadAllText = stm.ReadText(-1)
    stm.Close
    Set stm = Nothing
    Exit Function

FallbackAnsi:
    On Error Resume Next
    If Not stm Is Nothing Then
        stm.Close
        Set stm = Nothing
    End If
    On Error GoTo 0

    Dim ff As Integer
    Dim s As String
    ff = FreeFile
    Open filePath For Binary Access Read As #ff
    If LOF(ff) > 0 Then
        s = Space$(LOF(ff))
        Get #ff, , s
    End If
    Close #ff
    ReadAllText = s
End Function

Private Function ResolveDefaultSqlPath(ByVal sqlFileName As String) As String
    Dim candidates(1 To 7) As String
    Dim i As Long

    candidates(1) = CurrentProject.Path & "\sql\" & sqlFileName
    candidates(2) = CurrentProject.Path & "\..\sql\" & sqlFileName
    candidates(3) = CurrentProject.Path & "\..\..\sql\" & sqlFileName
    candidates(4) = CurrentProject.Path & "\..\..\..\sql\" & sqlFileName
    candidates(5) = CurrentProject.Path & "\..\furlab-access\sql\" & sqlFileName
    candidates(6) = CurrentProject.Path & "\..\..\furlab-access\sql\" & sqlFileName
    candidates(7) = "f:\FURLAB\dev\furlab-access\sql\" & sqlFileName

    For i = LBound(candidates) To UBound(candidates)
        If Dir$(candidates(i)) <> vbNullString Then
            ResolveDefaultSqlPath = candidates(i)
            Exit Function
        End If
    Next i

    ResolveDefaultSqlPath = vbNullString
End Function

Private Function PromptForSqlPath(ByVal sqlFileName As String) As String
    Dim suggested As String
    Dim inputPath As String

    suggested = "f:\FURLAB\dev\furlab-access\sql\" & sqlFileName
    inputPath = InputBox( _
        "Enter full path to SQL script:", _
        "FurLab Build - SQL path", _
        suggested)

    inputPath = Trim$(inputPath)
    If Len(inputPath) = 0 Then
        PromptForSqlPath = vbNullString
        Exit Function
    End If

    If Dir$(inputPath) = vbNullString Then
        MsgBox "File not found: " & inputPath, vbCritical
        PromptForSqlPath = vbNullString
        Exit Function
    End If

    PromptForSqlPath = inputPath
End Function

Private Function ResolveDefaultLogPath() As String
    Dim notesErrorsPath As String
    notesErrorsPath = CurrentProject.Path & "\notes\errors"
    ResolveDefaultLogPath = notesErrorsPath & "\build_db_errors.log"
End Function

Private Function GetParentFolder(ByVal filePath As String) As String
    Dim pos As Long
    pos = InStrRev(filePath, "\")
    If pos > 0 Then
        GetParentFolder = Left$(filePath, pos - 1)
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
        If Dir$(cur, vbDirectory) = vbNullString Then
            MkDir cur
        End If
    Next i
End Sub

Private Sub WriteLog(ByVal logPath As String, ByVal msg As String)
    Dim ff As Integer
    ff = FreeFile
    Open logPath For Append As #ff
    Print #ff, Format$(Now, "dd.mm.yyyy hh:nn:ss"); " | "; msg
    Close #ff
End Sub
