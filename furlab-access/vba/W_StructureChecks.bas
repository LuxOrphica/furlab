Attribute VB_Name = "W_StructureChecks"
Option Compare Database
Option Explicit

Private mDb As DAO.Database

Public Sub W_CheckSchemaStage1()
    Dim issues As Collection
    Dim msg As String

    Set mDb = CurrentDb
    Set issues = New Collection

    CheckRelation issues, "fk_Zone_partId", True, True
    CheckRelation issues, "fk_Zone_materialId", True, False
    CheckRelation issues, "fk_Fragment_zoneId", True, True
    CheckRelation issues, "fk_Layout_zoneId", True, True
    CheckRelation issues, "fk_LayoutRun_layoutId", True, True
    CheckRelation issues, "fk_InventoryLayoutConfig_layoutId", True, True
    CheckRelation issues, "fk_ScrapPiece_materialId", True, False
    CheckRelation issues, "fk_ScrapPiece_storageLocationId", True, False
    CheckRelation issues, "fk_ScrapPiece_scrapStatus", True, False
    CheckRelation issues, "fk_ScrapPiece_scrapQuality", True, False
    CheckRelation issues, "fk_ScrapReservation_scrapPieceId", True, False
    CheckRelation issues, "fk_ScrapReservation_layoutRunId", True, False
    CheckRelation issues, "fk_ScrapReservation_fragmentId", True, False
    CheckRelation issues, "fk_ScrapTransaction_scrapPieceId", True, False
    CheckRelation issues, "fk_ScrapTransaction_fromLocId", True, False
    CheckRelation issues, "fk_ScrapTransaction_toLocId", True, False
    CheckRelation issues, "fk_ScrapTransaction_statusBefore", True, False
    CheckRelation issues, "fk_ScrapTransaction_statusAfter", True, False
    CheckRelation issues, "fk_LRSP_layoutRunId", True, False
    CheckRelation issues, "fk_LRSP_fragmentId", True, False
    CheckRelation issues, "fk_LRSP_scrapPieceId", True, False
    CheckRelation issues, "fk_ImportSpecLine_batchId", True, False

    CheckUniqueIndex issues, "ScrapPiece", "ux_ScrapPiece_inventoryTag"
    CheckUniqueIndex issues, "StorageLocation", "ux_StorageLocation_locCode"

    CheckFieldRequired issues, "ScrapPiece", "inventoryTag", True
    CheckFieldRequired issues, "StorageLocation", "locCode", True
    CheckFieldRequired issues, "Layout", "layoutType", True
    CheckFieldRequired issues, "LayoutRunScrapPlacement", "layoutRunId", True
    CheckFieldRequired issues, "LayoutRunScrapPlacement", "fragmentId", True
    CheckFieldRequired issues, "LayoutRunScrapPlacement", "scrapPieceId", True

    msg = "Stage 1 check completed." & vbCrLf & _
          "Issues: " & issues.Count

    If issues.Count > 0 Then
        msg = msg & vbCrLf & vbCrLf & JoinCollection(issues, vbCrLf)
        MsgBox msg, vbExclamation, "W schema check"
    Else
        MsgBox msg, vbInformation, "W schema check"
    End If

    Set mDb = Nothing
End Sub

Public Sub W_EnableCascadeUpdateStage1()
    Dim changed As Long
    Dim missingOrFailed As Collection
    Dim msg As String

    Set mDb = CurrentDb
    Set missingOrFailed = New Collection

    EnableRelationCascadeUpdate "fk_Zone_partId", changed, missingOrFailed
    EnableRelationCascadeUpdate "fk_Fragment_zoneId", changed, missingOrFailed
    EnableRelationCascadeUpdate "fk_Layout_zoneId", changed, missingOrFailed
    EnableRelationCascadeUpdate "fk_LayoutRun_layoutId", changed, missingOrFailed
    EnableRelationCascadeUpdate "fk_InventoryLayoutConfig_layoutId", changed, missingOrFailed

    msg = "Cascade Update update completed." & vbCrLf & _
          "Changed: " & changed & vbCrLf & _
          "Issues: " & missingOrFailed.Count
    If missingOrFailed.Count > 0 Then
        msg = msg & vbCrLf & vbCrLf & JoinCollection(missingOrFailed, vbCrLf)
        MsgBox msg, vbExclamation, "W cascade fix"
    Else
        MsgBox msg, vbInformation, "W cascade fix"
    End If

    Set mDb = Nothing
End Sub

Private Sub CheckRelation(ByRef issues As Collection, ByVal relationName As String, ByVal mustEnforce As Boolean, ByVal mustCascadeUpdate As Boolean)
    Dim rel As DAO.Relation
    Dim found As Boolean
    Dim attrs As Long

    found = False
    For Each rel In CurrentDb.Relations
        If StrComp(rel.Name, relationName, vbTextCompare) = 0 Then
            found = True
            attrs = rel.Attributes
            Exit For
        End If
    Next rel

    If Not found Then
        issues.Add "Missing relation: " & relationName
        Exit Sub
    End If

    If mustEnforce Then
        If (attrs And dbRelationLeft) <> 0 Or (attrs And dbRelationRight) <> 0 Then
            issues.Add "Referential integrity likely not enforced: " & relationName
        End If
    End If

    If mustCascadeUpdate Then
        If (attrs And dbRelationUpdateCascade) = 0 Then
            issues.Add "Cascade Update is OFF: " & relationName
        End If
    End If
End Sub

Private Sub CheckUniqueIndex(ByRef issues As Collection, ByVal tableName As String, ByVal indexName As String)
    Dim tdf As DAO.TableDef
    Dim idx As DAO.Index
    Dim found As Boolean
    Dim canReadUnique As Boolean

    If Not TryGetTableDef(tableName, tdf) Then
        issues.Add "Missing table for index check: " & tableName
        Exit Sub
    End If

    found = False
    For Each idx In tdf.Indexes
        If StrComp(idx.Name, indexName, vbTextCompare) = 0 Then
            found = True
            canReadUnique = True
            On Error Resume Next
            If idx.Unique = False Then
                If Err.Number <> 0 Then canReadUnique = False
                issues.Add "Index is not UNIQUE: " & tableName & "." & indexName
            End If
            On Error GoTo 0
            If Not canReadUnique Then
                issues.Add "Cannot read index uniqueness: " & tableName & "." & indexName
            End If
            Exit For
        End If
    Next idx

    If Not found Then issues.Add "Missing index: " & tableName & "." & indexName
End Sub

Private Sub CheckFieldRequired(ByRef issues As Collection, ByVal tableName As String, ByVal fieldName As String, ByVal shouldBeRequired As Boolean)
    Dim tdf As DAO.TableDef
    Dim fld As DAO.Field
    Dim req As Boolean

    If Not TryGetTableDef(tableName, tdf) Then
        issues.Add "Missing table for field check: " & tableName
        Exit Sub
    End If

    If Not TryGetField(tdf, fieldName, fld) Then
        issues.Add "Missing field: " & tableName & "." & fieldName
        Exit Sub
    End If

    On Error Resume Next
    req = fld.Required
    If Err.Number <> 0 Then
        issues.Add "Cannot read Required property: " & tableName & "." & fieldName
        Err.Clear
        On Error GoTo 0
        Exit Sub
    End If
    On Error GoTo 0

    If shouldBeRequired And (req = False) Then
        issues.Add "Field should be NOT NULL: " & tableName & "." & fieldName
    End If
End Sub

Private Function TryGetTableDef(ByVal tableName As String, ByRef tdf As DAO.TableDef) As Boolean
    If mDb Is Nothing Then Set mDb = CurrentDb
    On Error Resume Next
    Set tdf = mDb.TableDefs(tableName)
    TryGetTableDef = (Err.Number = 0)
    Err.Clear
    On Error GoTo 0
End Function

Private Function TryGetField(ByVal tdf As DAO.TableDef, ByVal fieldName As String, ByRef fld As DAO.Field) As Boolean
    On Error Resume Next
    Set fld = tdf.Fields(fieldName)
    TryGetField = (Err.Number = 0)
    Err.Clear
    On Error GoTo 0
End Function

Private Function JoinCollection(ByVal items As Collection, ByVal delimiter As String) As String
    Dim i As Long
    Dim out As String
    For i = 1 To items.Count
        If i > 1 Then out = out & delimiter
        out = out & CStr(items(i))
    Next i
    JoinCollection = out
End Function

Private Sub EnableRelationCascadeUpdate(ByVal relationName As String, ByRef changed As Long, ByRef issues As Collection)
    Dim rel As DAO.Relation
    Dim found As Boolean
    Dim ok As Boolean

    If mDb Is Nothing Then Set mDb = CurrentDb

    found = False
    For Each rel In mDb.Relations
        If StrComp(rel.Name, relationName, vbTextCompare) = 0 Then
            found = True
            Exit For
        End If
    Next rel

    If Not found Then
        issues.Add "Missing relation: " & relationName
        Exit Sub
    End If

    If (rel.Attributes And dbRelationUpdateCascade) = 0 Then
        On Error GoTo RecreatePath
        rel.Attributes = rel.Attributes Or dbRelationUpdateCascade
        changed = changed + 1
        On Error GoTo 0
    End If
    Exit Sub

RecreatePath:
    Err.Clear
    ok = RecreateRelationWithCascade(relationName)
    If ok Then
        changed = changed + 1
    Else
        issues.Add "Cannot set Cascade Update for " & relationName
    End If
End Sub

Private Function RecreateRelationWithCascade(ByVal relationName As String) As Boolean
    Dim oldRel As DAO.Relation
    Dim newRel As DAO.Relation
    Dim oldFld As DAO.Field
    Dim fldDefs As Collection
    Dim pair As Variant
    Dim attrsNew As Long
    Dim localTable As String
    Dim foreignTable As String
    Dim hadDeleteCascade As Boolean
    Dim hadDontEnforce As Boolean

    On Error GoTo Fail
    If mDb Is Nothing Then Set mDb = CurrentDb

    Set oldRel = mDb.Relations(relationName)
    localTable = oldRel.Table
    foreignTable = oldRel.ForeignTable
    hadDeleteCascade = ((oldRel.Attributes And dbRelationDeleteCascade) <> 0)
    hadDontEnforce = ((oldRel.Attributes And dbRelationDontEnforce) <> 0)

    Set fldDefs = New Collection
    For Each oldFld In oldRel.Fields
        fldDefs.Add Array(oldFld.Name, oldFld.ForeignName)
    Next oldFld

    mDb.Relations.Delete relationName

    attrsNew = dbRelationUpdateCascade
    If hadDeleteCascade Then attrsNew = attrsNew Or dbRelationDeleteCascade
    If hadDontEnforce Then attrsNew = attrsNew Or dbRelationDontEnforce

    Set newRel = mDb.CreateRelation(relationName, localTable, foreignTable, attrsNew)
    For Each pair In fldDefs
        Set oldFld = newRel.CreateField(CStr(pair(0)))
        oldFld.ForeignName = CStr(pair(1))
        newRel.Fields.Append oldFld
    Next pair
    mDb.Relations.Append newRel

    RecreateRelationWithCascade = True
    Exit Function

Fail:
    RecreateRelationWithCascade = False
    Err.Clear
End Function
